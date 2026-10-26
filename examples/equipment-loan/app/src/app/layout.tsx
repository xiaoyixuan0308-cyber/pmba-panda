import type { Metadata } from "next";
import "./globals.css";

// System fonts only: the prototype must work offline (demos often run on
// meeting-room or intranet networks), so no fonts are fetched from the web.
export const metadata: Metadata = {
  title: "设备借用系统（原型）",
  description: "星河学院传媒中心设备借用系统原型。所有数据均为虚构。",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN" className="h-full antialiased">
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
