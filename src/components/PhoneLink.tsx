// Tap-to-call link. On a phone (and the installed PWA) this opens the dialer;
// on desktop it hands off to the default calling app. stopPropagation so it
// works inside clickable rows/cards without triggering navigation.

import { formatPhone, telHref } from "../lib/phone";
import { PhoneIcon } from "./icons";

export function PhoneLink({
  phone,
  className = "",
  iconClassName = "size-3.5",
}: {
  phone: string;
  className?: string;
  iconClassName?: string;
}) {
  return (
    <a
      href={telHref(phone)}
      onClick={(e) => e.stopPropagation()}
      className={`tnum inline-flex items-center gap-1 font-medium text-sky-700 underline-offset-2 hover:underline ${className}`}
      title={`Call ${formatPhone(phone)}`}
    >
      <PhoneIcon className={iconClassName} />
      {formatPhone(phone)}
    </a>
  );
}
