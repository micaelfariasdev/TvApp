import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { backendRequest, getAdminSessionToken } from "@/lib/server-api";

export default function ProtectedLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main className="protected-loading">Verificando acesso seguro...</main>}>
      <RequireAdminSession>{children}</RequireAdminSession>
    </Suspense>
  );
}

async function RequireAdminSession({ children }: { children: ReactNode }) {
  const token = await getAdminSessionToken();
  if (!token) redirect("/login");

  let authenticated = false;
  try {
    const response = await backendRequest("/tvbox/api/v2/session", {}, token);
    authenticated = response.ok;
  } catch (error) {
    console.error("Falha ao validar acesso ao painel:", error);
    return (
      <main className="auth-unavailable">
        <section>
          <span className="eyebrow">ACESSO PROTEGIDO</span>
          <h1>Não foi possível validar sua sessão</h1>
          <p>O servidor administrativo está indisponível. Tente novamente em instantes.</p>
          <a className="button button-primary" href="/cinedark/login">Voltar ao login</a>
        </section>
      </main>
    );
  }
  if (!authenticated) redirect("/login");

  return children;
}
