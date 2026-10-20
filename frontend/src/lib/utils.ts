import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
export function dateTime(value: string) {
  return new Date(value).toLocaleString("zh-CN");
}
export const deviceTypes: Record<string, string> = {
  ap: "无线 AP",
  switch: "交换机",
  gateway: "网关",
  controller: "控制器",
};
