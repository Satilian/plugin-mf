import styles from "./p.module.css";

export const P = ({ text }: { text?: string }) => {
  return <p className={styles.paragraph}>{text}</p>;
};
