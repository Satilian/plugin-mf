import type { RoutesConfigObject } from "@satilian/router";
import { Layout } from "../layout/layout";
import { HomePage } from "./home";
import { AboutPage } from "./about";

export const routesConfig: RoutesConfigObject = {
  routes: [
    {
      path: "/",
      layout: <Layout />,
      children: [
        {
          index: true,
          element: <HomePage />,
        },
        {
          path: "about",
          element: <AboutPage />,
        },
      ],
    },
  ],
};
