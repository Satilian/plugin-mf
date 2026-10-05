import { Suspense, useEffect, useState } from "react";
import Button from "subhost1/Button";
import s from "./section.module.css";

interface SectionProps extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> {}

export const Section = ({ children, ...props }: SectionProps) => {
  const [count, setCount] = useState(0);
  const [text, setText] = useState("");

  useEffect(() => {
    setText(`Count is ${count}`);

    const timer = setTimeout(() => {
      setText("");
    }, 1000);

    return () => clearTimeout(timer);
  }, [count]);

  return (
    <section className={s.section} {...props}>
      {children}

      <Suspense>
        <Button onClick={() => setCount(count + 1)}>{text || "Section button"}</Button>
      </Suspense>
    </section>
  );
};
