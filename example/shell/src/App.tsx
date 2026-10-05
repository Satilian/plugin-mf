import { RouterProvider, type RouterProviderProps } from "@satilian/router";
import "./App.css";
import { routesConfig } from "./pages/routes";

type AppProps = Omit<RouterProviderProps, "config"> & {};

const App = ({ pathname, query }: AppProps) => {
  return pathname ? (
    // SSR
    <RouterProvider config={routesConfig} pathname={pathname} query={query} />
  ) : (
    // Client
    <RouterProvider config={routesConfig} />
  );
};

export default App;
