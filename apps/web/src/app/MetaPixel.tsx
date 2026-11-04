"use client";

/**
 * Пиксель Meta (Facebook): PageView на страницах для клиентов. Админка и панели эксперта и оператора
 * не отслеживаются. Сайт переходит между страницами без перезагрузки, поэтому PageView при переходе
 * отправляем сами; первый отправляет код пикселя при загрузке.
 */
import Script from "next/script";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";

export const META_PIXEL_ID = "2274909263238819";

const STAFF = /^\/(admin|expert|operator)(\/|$)/;

declare global {
  interface Window {
    fbq?: (...args: unknown[]) => void;
  }
}

export function MetaPixel() {
  const pathname = usePathname();
  const staff = STAFF.test(pathname);
  const first = useRef(true);

  useEffect(() => {
    if (staff) return;
    if (first.current) {
      first.current = false;
      return;
    }
    window.fbq?.("track", "PageView");
  }, [pathname, staff]);

  if (staff) return null;
  return (
    <Script id="meta-pixel" strategy="afterInteractive">
      {`!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?
n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;n.push=n;n.loaded=!0;
n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;t.src=v;s=b.getElementsByTagName(e)[0];
s.parentNode.insertBefore(t,s)}(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');
fbq('init','${META_PIXEL_ID}');fbq('track','PageView');`}
    </Script>
  );
}
