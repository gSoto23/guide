/**
 * An email address that, when it does not fit, wraps right after the "@" instead of in the middle
 * of a word (spec 015: no cut text), for example "ana.mora@" then "example.com".
 */
export function EmailText({ email }: { email: string }) {
  const at = email.lastIndexOf("@");
  if (at <= 0) return <>{email}</>;
  return (
    <>
      {email.slice(0, at + 1)}
      <wbr />
      {email.slice(at + 1)}
    </>
  );
}
