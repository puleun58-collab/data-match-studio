import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import './globals.css';

export const metadata: Metadata = {
  title: 'Data Match Studio',
  description: '브라우저 안에서 Excel, CSV, TSV 파일을 안전하게 비교하는 데이터 도구',
  applicationName: 'Data Match Studio',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="ko">
      <body>
        <a className="skip-link" href="#main-content">본문으로 건너뛰기</a>
        {children}
      </body>
    </html>
  );
}
