export function AuthMessage({ error, message }: { error?: string; message?: string }) {
  if (!error && !message) return null;
  return <div className={`auth-message ${error ? "auth-error" : "auth-success"}`} role="status">{error ?? message}</div>;
}
