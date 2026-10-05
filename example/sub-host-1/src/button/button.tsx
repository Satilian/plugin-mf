import type { ButtonHTMLAttributes, DetailedHTMLProps } from "react";

import s from "./button.module.css";

interface IProps extends DetailedHTMLProps<ButtonHTMLAttributes<HTMLButtonElement>, HTMLButtonElement> {
  btnType?: string;
  size?: string;
}

export const Button = ({ size, className, ...props }: IProps) => (
  <button className={`${s.button} ${size && s[`size-${size}`]} ${className}`} {...props} />
);
