# Rslib project

## Setup

Install the dependencies for the entire workspace:

```bash
pnpm install
```

## Get started

Build the library, builds all examples, then starts their servers in parallel:

- Open [http://localhost:3000](http://localhost:3000) for the shell;
- host-1, host-2 and sub-host-1 run on ports 3001, 3002 and 4001.
- Press Ctrl+C to stop the servers.
- Rerun the command after changing library code.

```bash
pnpm start
```

Build the library:

```bash
pnpm run build
```

Build the library in watch mode:

```bash
pnpm run dev
```

Run tests:

```bash
pnpm run test
```

Run tests in watch mode:

```bash
pnpm run test:watch
```

## Provider releases and rollback

Provider builds preserve `dist/mf/` during Rsbuild output cleanup, including the
current pointer and previous releases. Other output files follow the configured
cleanup rules. Each successful release includes `mf/<releaseId>/pointer.json`,
a snapshot of the root `mf/manifest.json` for rollback; its paths are relative to
`mf/`, not to the snapshot directory.

Publish the complete `mf/<releaseId>/` directory before replacing
`mf/manifest.json`. On a filesystem, replace the pointer with a temporary file
and rename in the same directory; on object storage, use the storage's atomic
object replacement. Keep older release directories when deploying a new build.
Configure `Cache-Control: no-store` for the root pointer and long-lived immutable
caching for files inside release directories. Serialize deployments per provider
so an older build cannot overwrite a newer deployment's pointer.

To roll back, verify that the target release's server, client and types artifacts
are still available, then atomically replace `mf/manifest.json` with the contents
of that release's `pointer.json`. New SSR requests select the restored release;
in-flight requests and open pages keep their previously selected versions.

Releases are retained indefinitely by default; the plugin does not prune them.
A finite retention period requires a defined maximum lifetime for an open page,
including delayed imports, plus HTML/CDN cache lifetime and the rollback window.
Measure retention from the last time a release stopped being current, including
after a rollback. Never remove the current release or releases inside that window.
Incomplete unpublished release directories may be removed after their build has
stopped. Legacy providers without versioned paths cannot offer these guarantees.

## Server module cache

Configure the cache before creating remotes or starting SSR:

```ts
import { configureServerCache } from "plugin-mf/server";

configureServerCache({
  cacheDir: "./.cache/mf",
  maxBytes: 512 * 1024 * 1024,
  lockTimeoutMs: 30_000,
});
```

Defaults: `node_modules/.cache/mf` relative to the worker's working directory,
512 MiB of completed entries, and 30 seconds waiting for the filesystem lock.
`MF_CACHE_DIR` and `MF_CACHE_MAX_BYTES` provide environment defaults. An explicit
configuration takes precedence. The directory is checked for write access on
first use. Nested remote bundles share the configured loader.

Server manifests include a `files` list for each expose, containing emitted
entries, chunks and assets. The loader downloads that set before importing the
entry, preserves relative paths and binary contents, and publishes the complete
cache directory atomically. Old manifests without `files` retain entry-only
loading. Cache identity includes provider, release ID and full asset URLs;
different providers, releases and query strings cannot share a module by filename.

`new Loader(options)` creates a standalone loader; the previous
`new Loader(cacheDir)` form is also supported. `pruneCache()` removes unused
entries until `maxBytes` is satisfied. `clearCache()` removes all unused entries.
Both return `{ bytes, protectedBytes, removedEntries, overBudgetBytes }` and leave
the in-memory module cache intact. The configured limit covers completed entries,
not transient downloads or files left by the old flat-cache implementation.

Imported releases have process-lifetime leases: deleting them could break a later
dynamic import or asset read. Cleanup skips leases belonging to live processes
and removes leases of exited processes. If live releases prevent a new release
from fitting the byte limit, loading fails explicitly; raise the limit or roll
workers. Clearing files does not unload Node's ESM module cache. Select a new
release URL for new code; restart workers to unload previously imported versions.

Cache operations use an interprocess filesystem lock, so download publication,
leases and cleanup cannot race. A dead owner's lock and abandoned download
directories are recovered on the next operation. If a process dies during lock
recovery itself, an explicit recovery error is raised: stop all cache users before
removing `.recovery`. Use a dedicated directory on a local filesystem shared by
workers on the same machine; PID leases do not coordinate different hosts.

## Ограничение загрузки и восстановление

`pluginMF({ loading: { manifestTimeoutMs: 5000, moduleTimeoutMs: 15000,
typesTimeoutMs: 15000, retries: 2, retryDelayMs: 100,
circuitBreaker: { failureThreshold: 3, cooldownMs: 10000 } } })` задаёт политику
сборки и runtime. Все поля необязательны; в примере показаны значения по умолчанию.
Вручную созданные загрузчики настраиваются через `configureLoading` из
`plugin-mf/client` или `plugin-mf/server` до начала загрузок. Настройка общая для
одного JS realm, включая вложенные remote bundles; consumer задаёт общую политику,
providers не должны переопределять её своими значениями `loading`.

`manifestTimeoutMs` ограничивает один манифест вместе с чтением тела и повторами.
`moduleTimeoutMs` ограничивает всю загрузку expose, включая выбор релиза, манифесты,
модуль и серверные assets. `typesTimeoutMs` — весь набор типов одного provider.
Повторы используют экспоненциальную задержку в пределах исходного бюджета времени:
сетевые ошибки и HTTP 408/429/500/502/503/504, максимум `retries` дополнительных
попыток (0–10). Ошибки формата, остальные HTTP-статусы и ошибки исполнения не повторяются.
Только 404 указателя релиза включает legacy layout.

Ошибки `RemoteLoadError` содержат `remote` (URL provider), `releaseId` (если выбран),
`stage`, `code`, необязательный HTTP `status` и `cause`. Этапы: `release-manifest`,
`manifest`, `module`, `types`; коды: `LOAD_FAILED`, `HTTP_ERROR`, `TIMEOUT`,
`ABORTED`, `CIRCUIT_OPEN`. Circuit breaker учитывает неуспешные загрузки expose
или типов по provider, исключает отмену SSR, после порога отказывает без сетевых
запросов и после cooldown разрешает одну пробную загрузку. Успех закрывает circuit.

Неуспешный `React.lazy` сохраняет ошибку до явного `getRemote(name).retry(expose)`.
После этого нужно сбросить локальный Error Boundary; сгенерированные remote imports
и `createRemoteComponent` получат новый lazy при рендере. Для ручного использования
`lazyComponent` также заново получите компонент после `retry`. Повторный `retry`
не сбрасывает уже начатую попытку. Успешные модули и выбранный релиз сохраняются.
Браузерная повторная загрузка использует `mf_retry` в query того же release URL,
чтобы обойти кеш неуспешного import; CDN должен принимать этот query.

Пример `example/shell/src/remote-boundary.tsx` сочетает локальный Error Boundary,
кнопку повторной загрузки и Suspense fallback. На сервере ошибки внутри Suspense
оставляют fallback для клиентского восстановления. В `example/shell/src/server.tsx`
SSR ограничен 8 секундами и прерывается при отключении клиента:
`runWithMFRequest(callback, { signal })` отменяет ожидание remote и запросы манифестов,
а consumer также вызывает `stream.abort()`. Общая дедуплицированная серверная загрузка
имеет независимый deadline: отмена одного запроса не ломает другие SSR-запросы.
Нативный import и уже исполняемый JavaScript нельзя остановить AbortSignal;
таймаут ограничивает ожидание, но не прерывает исполнение модуля и не очищает ESM-кеш.

## Архитектура и проверка изменений

Пакет сохраняет четыре публичных входа: основной Rsbuild-плагин, client, server и shared.
Входные файлы служат фасадами; внутренние модули не являются публичным API.

| Модуль | Ответственность |
| --- | --- |
| protocol | Чистые контракты и проверка манифестов, путей и SSR-данных |
| transport | Общая сетевая загрузка манифеста релиза |
| build | Hooks Rsbuild, конфигурация Rspack, артефакты и типы |
| runtime/core | Выбор релиза и загрузка экспорта через ModuleLoader |
| runtime/react | Типизированные компоненты, lazy и CSS |
| runtime/client | Браузерный загрузчик и чтение SSR-релизов |
| runtime/server | Контекст SSR, ESM import и файловый кеш |
| sharing | Реестр общих зависимостей |

Сборка и runtime используют protocol и transport. Общий runtime не зависит от React
и платформенных адаптеров. Серверный Loader управляет памятью и импортом, DiskCache —
файлами; блокировки и очистка вынесены в отдельные модули. Эти границы проверяет ESLint.

Команда pnpm check запускает строгую проверку TypeScript, ESLint, существующие тесты
и сборку библиотеки. pnpm start дополнительно собирает и запускает все примеры
с ожиданием HTTP-манифестов зависимостей. Проверка SSR и гидрации выполняется отдельно.

## Миграция типизации

Параметр `loading` и второй аргумент `runWithMFRequest` необязательны. Существующая
конфигурация работает с конечными таймаутами и ограниченными повторами по умолчанию.
Для восстановления ручного lazy после ошибки вызовите `remote.retry(expose)`,
заново получите `lazyComponent(expose)` и сбросьте Error Boundary.

Имена функций, конфигурация плагина и форматы манифестов сохранены.
getShared возвращает unknown вместо any: перед использованием значение нужно
сузить до ожидаемого контракта. Методы component и lazyComponent принимают generic
тип props; createRemoteComponent также передаёт его в lazy-компонент.

При недоступности деклараций синхронизация по-прежнему выдаёт предупреждение,
но fallback-модуль имеет тип unknown. Использование такого импорта как React-компонента
теперь требует восстановления типов provider; прежний fallback any скрывал потерю контракта.
Режимы strict/best-effort/off остаются отдельной задачей IMPROVEMENT_PLAN.md.

## Проектные инструменты Codex

Правила находятся в AGENTS.md, три специализированных skill — в .agents/skills.
Проектная .codex/config.toml подключает Context7 для документации и Playwright MCP
для проверки примеров в изолированном headless Chrome. Playwright закреплён на версии
0.0.83; для запуска нужны Node.js с npx и установленный Google Chrome.
Глобальные настройки Codex не меняются. Для загрузки проектного конфига проект должен
быть доверенным; новые tools появляются после обновления MCP-подключений или новой сессии.

Context7 настроен на https://mcp.context7.com/mcp без ключа. Если для вашего доступа
потребуется авторизация или повышенный лимит, передавайте ключ через локальное окружение
и настройки заголовков клиента; не добавляйте секреты в репозиторий. Документацию сверяйте
с установленной версией и первоисточниками Rsbuild/Rspack/Rslib.

Источники настройки: [Codex](https://learn.chatgpt.com/docs/config-file/config-reference),
[skills](https://learn.chatgpt.com/docs/build-skills),
[Context7](https://github.com/upstash/context7),
[Playwright MCP](https://github.com/microsoft/playwright-mcp).
