import type { DetailedHTMLProps, HTMLAttributes } from "react";

interface IProps extends DetailedHTMLProps<HTMLAttributes<HTMLSpanElement>, HTMLSpanElement> {}

export const Span = (props: IProps) => {
  return <span {...props} />;
};
