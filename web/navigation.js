// Keep the phone test credential on explicitly marked same-origin routes only.
document.querySelectorAll('a[data-preserve-access]').forEach(link => {
  const destination = new URL(link.href, location.href);
  if (destination.origin === location.origin) link.hash = location.hash;
});
