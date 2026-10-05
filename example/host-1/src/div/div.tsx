import { Suspense } from "react";
import Button from "subhost1/Button";
import s from "./div.module.css";

export const Div = ({ children }: { children?: React.ReactNode }) => {
  return (
    <div className={s.div}>
      {children}

      <Suspense fallback={<div>Loading...</div>}>
        <Button>Button from subhost1</Button>
      </Suspense>
    </div>
  );
};
