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

## Синхронизация типов

`pluginMF({ types: { mode: "strict", concurrency: 8 } })` настраивает типы consumer.
По умолчанию используется `best-effort`: при отказе обновления сохраняется последний
успешный контракт с предупреждением и его releaseId; если кеша нет, явно сообщается
о fallback `unknown`. `strict` завершает сборку ошибкой и сохраняет предыдущие lock
и `src/mf-types.d.ts`. `off` пропускает синхронизацию без изменения файлов и сети.

В корне consumer создаётся `mf-types.lock.json`: URL provider, releaseId, URL
манифеста деклараций и SHA-256 ключ содержимого. Сохраните его в Git для CI.
Существующие записи фиксированы: обычная повторная сборка проверяет кеш и не
обращается даже к указателю provider. Новые remotes добавляются автоматически,
если не включён `frozenLockfile`. Обновление выбранных релизов требует `updateLock`.
При том же releaseId обновление проверяет только указатель, повторная загрузка
деклараций не нужна. Legacy provider фиксируется по содержимому без releaseId;
его обновление требует повторной загрузки типов.

Кеш находится в `node_modules/.cache/mf-types/<releaseId|legacy>/<cacheKey>/`.
Файлы загружаются во временный каталог; перед атомарной публикацией проверяются
пути, наличие относительных зависимостей, синтаксис TypeScript и экспорты из
манифеста. Контрольные суммы проверяются при повторном использовании. Успешные
версии сохраняются; повреждённый кеш online восстанавливается из locked URL,
а изменение содержимого locked релиза отклоняется. Проверка не заменяет `tsc`
consumer и не проверяет совместимость версий внешних пакетов.

Дополнительные `types`-параметры:

| Параметр | Поведение |
| --- | --- |
| `remotes: ["host1"]` | Синхронизировать только перечисленные remotes; остальные записи и доступные типы сохраняются |
| `concurrency: 8` | Общий лимит сетевых запросов всех remotes в одной синхронизации, включая чтение ответов и повторы |
| `frozenLockfile: true` | Требовать существующие записи всех выбранных remotes; не менять lock |
| `offline: true` | Требовать lock и использовать только проверенный локальный кеш, без сети |
| `updateLock: true` | Выбрать текущие релизы заново; несовместимо с offline/frozen |
| `lockfile: "mf-types.lock.json"` | Путь относительно корня consumer |

Для отдельной команды создайте `mf-types.config.json` рядом с `src/` consumer:

```json
{
  "remotes": { "host1": "https://host1.example/mf" },
  "types": { "mode": "strict", "concurrency": 8 }
}
```

Импортируйте `remotes` из того же JSON в конфигурацию Rsbuild. Режим `types.mode`
в Rsbuild можно установить в `off`, чтобы синхронизация выполнялась только командой.
CLI читает JSON без запуска Rsbuild; корень consumer определяется каталогом конфига.
С установленным пакетом используйте `pnpm exec plugin-mf-types`; в этом репозитории
после `pnpm build` доступны следующие команды:

```bash
pnpm types:sync --config example/shell/mf-types.config.json --mode strict --update-lock
pnpm types:sync --config example/shell/mf-types.config.json --mode strict --frozen-lockfile
pnpm types:sync --config example/shell/mf-types.config.json --mode strict --offline --frozen-lockfile
pnpm types:sync --config example/shell/mf-types.config.json --remote host1 --update-lock
```

`--remote` можно повторять. Флаги переопределяют соответствующие параметры JSON.
CLI использует стандартные таймауты загрузки; программный `syncTypes` экспортируется
из `plugin-mf` и поддерживает общую политику `configureLoading`. Для offline CI
восстановите `node_modules/.cache/mf-types` вместе с lock-файлом до сборки.
Без локального кеша offline/strict завершается ошибкой; online/frozen скачивает
только зафиксированные URL и проверяет содержимое. Типы фиксируются независимо от
runtime-выбора релиза: для нового контракта обновляйте lock перед сборкой consumer.
Не запускайте синхронизацию одного consumer одновременно в разных процессах:
атомарные записи защищают файлы, но не объединяют независимые обновления lock.
Локальные lock-файлы примеров игнорируются, поскольку их providers создают новые
releaseId при сборке. Генерируемый `src/mf-types.d.ts` также не хранится в Git.

## Совместимость shared

`shared` и `externals` принимают строки и объекты
`{ name, version?, requiredVersion?, singleton? }`. Версия берётся из установленного
пакета consumer/provider; явная `version` проверяется на совпадение с ней.
По умолчанию `requiredVersion` — `^<installedVersion>`, `singleton` — `true`.
Диапазоны проверяются npm semver, включая правила prerelease.

`shared` регистрирует модули host с реальными версиями. `externals` описывает
зависимости provider, которые должны предоставляться host: их требования попадают
в поля `shared.client` и `shared.server` release-манифеста и проверяются до
скачивания и исполнения remote. Требования browser и SSR одинаково обязательны.
Исключение содержит provider, releaseId, имя зависимости, диапазон и доступные версии.

Запросы subpath регистрируются отдельно: namespace `react` нельзя использовать
вместо `react/jsx-runtime`. Для `react` автоматически включаются
`react/jsx-runtime` и `react/jsx-dev-runtime`; они наследуют требования корневого
пакета. Остальные subpaths перечисляются явно и используют версию своего пакета;
объект корневого пакета задаёт им значения по умолчанию.

Реестр общий для вложенных bundles одного JS realm. Singleton запрещает регистрацию
другой версии и сохраняет первую инстанцию той же версии. При `singleton: false`
можно зарегистрировать несколько версий; external получает старшую совместимую.
`getShared(name, scope?, requiredVersion?)` поддерживает тот же выбор.
`getShareScope()` возвращает снимок с наибольшей версией каждого модуля.

### Миграция shared

Строковые массивы сохранены, но теперь используют реальные версии и проверяются.
Для другого допустимого диапазона задайте `requiredVersion` явно. Ручная
регистрация должна передавать фактическую версию:
`registerShared("react", React, "19.2.8")`. Старый default `0.0.0` сохранён
для legacy-кода и не удовлетворяет новым требованиям React.
Старые манифесты без `shared` читаются без предварительной проверки; пересоберите
providers, чтобы включить проверку. Манифесты и требования должны публиковаться
вместе с артефактами того же релиза.

## CSP и доверенные источники

Браузерный loader использует нативный import без `new Function` и не требует
`unsafe-eval`. Rslib сохраняет magic comment для сборщика consumer. Для streaming
SSR нужны inline-скрипты React: настройте nonce в приложении либо отдельную политику
inline scripts; отсутствие `unsafe-eval` не отменяет это требование.

`pluginMF({ network: { allowedProtocols: ["https:"], allowedOrigins: ["https://provider.example"], requireServerIntegrity: true } })`
задаёт общую политику consumer. Ручная настройка доступна через `configureNetwork`
из client/server. По умолчанию разрешены HTTP(S) и только origin конкретного provider;
явный список origins заменяет это правило и должен включать все providers/CDN.
URL с credentials, другие схемы и origins отклоняются до запроса. Политика применяется
к манифестам, типам, JS, серверным assets и CSS из манифеста.

Fetch обрабатывает не более пяти redirects вручную, проверяя каждый следующий URL
и конечный адрес. Браузер скрывает Location при manual redirect: такие opaque
redirects отклоняются, поэтому browser endpoints должны быть прямыми URL.
Перед native import выполняется fetch-проверка entry с той же политикой; immutable
HTTP-кеш предотвращает повторную передачу тела. CSP `script-src`, `connect-src`
и `style-src` приложения должны разрешать необходимые sources. Imports внутри
доверенного remote-кода контролируются CSP, а не переписываются плагином.

Новые серверные манифесты содержат SHA-256 каждого entry/chunk/asset. Полный набор
проверяется при скачивании и чтении дискового кеша до первого import. Хеши входят
в идентичность кеша. Несовпадение останавливает загрузку; активный ESM-кеш не удаляется.
`requireServerIntegrity: true` отклоняет также legacy assets без хешей; по умолчанию
они принимаются для миграции. Пересоберите providers перед включением строгого режима.

Provider, манифест, deployment pipeline и локальный кеш должны быть доверенными.
Хеш в подменённом манифесте не защищает от подмены артефакта. Публикуйте неизменяемый
полный релиз через TLS до атомарного обновления pointer, ограничивайте права записи
в кеш и список sources. Серверный remote имеет права процесса host; это не sandbox.
JS уже загруженного модуля и последующие действия доверенного кода нельзя ограничить
проверкой URL в loader. Настройка network общая для realm, её задаёт consumer.

## События, метрики и tracing

`configureObservability(handler)` из client/server подключает обработчик без
зависимости от monitoring SDK; вызов без handler отключает его. События содержат
`remote`, выбранный `releaseId`, `stage`, `operation`, тип события и длительность
в миллисекундах. `start` и `success/error` объединяются по `loadId`; также есть
`cache-hit`, `retry`, `download` и `prune`. Operation различает загрузку expose,
fetch, module import, types и disk. Объём disk-событий — проверенные скачанные bytes.
Cleanup использует системный remote `cache://server`.

`runWithMFRequest(callback, { requestId, signal })` привязывает события к SSR-запросу
через AsyncLocalStorage, общий для вложенных bundles. В примере shell `MF_TRACE=1`
включает JSON-логирование; requestId берётся из `x-request-id` либо генерируется.
Для tracing-адаптера начинайте span по start/loadId, завершайте его по success/error,
добавляйте requestId как correlation attribute. Callback может быть async; его ошибки
логируются отдельно и не нарушают загрузку. Сам adapter отвечает за экспорт spans
и ограничение своей очереди. Не сохраняйте объекты HTTP-запросов внутри handler.

`getLoadingMetrics()` возвращает снимок накопленных starts, successes, errors,
cacheHits, retries, downloadedBytes, diskHits, diskDownloads и prunedBytes.
Счётчики общие для одного JS realm; вложенные операции учитываются отдельно,
это не число HTTP-запросов пользователя. Для разрезов по provider/requestId собирайте
события своим handler. URL в событиях очищены от credentials, query и fragment;
ошибка содержит только code/status. Исходные cause и тела ответов не экспортируются.

## Chunks, preload и бюджеты маршрута

`pluginMF({ splitChunks: true })` разрешает общие browser chunks provider.
Entry выбирается из entrypoint chunk, манифест содержит размеры всего набора JS/CSS,
а ESM entry загружает общие chunks из того же release path. По умолчанию splitChunks
выключен: больше chunks не гарантирует ускорение. Для каждого client build создаётся
`bundle-report.json` с размерами assets и модулями, присутствующими в нескольких
chunks. Размеры модулей в отчёте приблизительные, без gzip; внешние модули могут
появляться как несколько маленьких ссылок, а не реальные копии пакета.

`preloadRemotes([{ remote: "host1", expose: "Div" }], { concurrency: 4, maxRemotes: 3,
maxJSBytes: 5000000, maxCSSBytes: 200000 })` доступен из client/server.
Сначала загружаются только манифесты выбранных exposes, проверяются бюджеты, затем
выполняются импорты с ограничением числа одновременных preload-задач. Если бюджет
превышен, ни один модуль этой попытки не импортируется. maxRemotes считает разные
providers; JS/CSS учитываются один раз по полному asset URL. Манифест консервативно
описывает весь client-набор provider, включая отложенные chunks; бюджет является
верхней границей, а не прогнозом фактических bytes маршрута. Включайте в маршрут
layout и вложенные remotes. Legacy без размеров не поддерживает byte-бюджеты.

Preload прогревает модульный кеш; CSS применяется при последующем рендере компонента.
`signal` останавливает постановку новых задач, уже начатые общие загрузки сохраняются.
Ограничение относится к задачам, native import может параллельно загрузить свои chunks.
Пример shell запускает preload следующей страницы при hover/focus ссылки и сохраняет
локальный fallback при ошибке.

`pnpm benchmark:routes` измеряет Home/About через локальный Playwright и Chrome.
Если Playwright установлен отдельно, передайте `--playwright-module` с file URL
его index.mjs. `--output` выбирает JSON-файл; `--runs` — число повторов. CDP считает
encoded bytes JS/CSS, включая fetch-проверку entry перед native import; измерение
заканчивается после проверки интерактивности вложенного компонента. Fresh/reused
browser contexts разделяют холодный и повторный браузерный кеш; серверный кеш между
образцами не очищается. Это локальный smoke benchmark, не production SLA.

Результаты сравнения одной версии кода с выключенным/включённым splitChunks находятся
в `benchmarks/P2.2-before.json` и `benchmarks/P2.2-after.json` (по три прогона).
Home: холодный JS 1773182 → 1758371 bytes, запросы 16 → 19.
About: 1820954 → 1830858 bytes, запросы 15 → 19.
Медиана интерактивности cold Home 485 → 511 ms, About 535 → 475 ms;
малый объём выборки и React Refresh делают задержки шумными. Поэтому в этих примерах
разделение не включено по умолчанию; включайте его для конкретного workload после замеров.

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

Для кеша старого плоского формата выполните online-синхронизацию один раз: она создаст
lock и версионные каталоги. Старые файлы не удаляются. Режим `best-effort` сохраняет
последние успешные типы; при их отсутствии fallback имеет тип `unknown`.
Для CI используйте `strict` и `frozenLockfile`, обновляйте lock отдельной командой
с `--update-lock`. Для полностью автономной сборки также восстановите кеш и задайте
`offline: true`. Существующий hook синхронизации сохранён; для отдельного этапа
установите `types.mode: "off"` в конфигурации Rsbuild.

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
