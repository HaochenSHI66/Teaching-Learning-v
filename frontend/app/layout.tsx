import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PPT 分屏讲解学习助手",
  description: "分屏看 PPT，逐页讲解、追问和导出笔记",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
