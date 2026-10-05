import { Outlet, RouterSuspense } from "@satilian/router";
import Button from "subhost1/Button";
import styles from "./layout.module.css";
import { Suspense } from "react";

export const Layout = () => {
  return (
    <div className={styles.content}>
      <h1 className={styles.header}>Header</h1>

      <RouterSuspense fallback={<div>Loading...</div>}>
        <Outlet />
      </RouterSuspense>

      <p>
        Footer{" "}
        <Suspense>
          <Button>Click Me</Button>
        </Suspense>
      </p>
    </div>
  );
};
