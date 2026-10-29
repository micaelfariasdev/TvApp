"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { appPath } from "@/lib/app-path";

export default function LoginPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch(appPath("/api/session"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const payload: unknown = await response.json();
      if (!response.ok) {
        const message =
          typeof payload === "object" &&
          payload !== null &&
          "error" in payload &&
          typeof payload.error === "string"
            ? payload.error
            : "Não foi possível entrar no painel.";
        throw new Error(message);
      }
      router.replace("/");
      router.refresh();
    } catch (loginError: unknown) {
      setError(
        loginError instanceof Error
          ? loginError.message
          : "Não foi possível entrar no painel.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <main className="login-page">
      <section aria-labelledby="login-title" className="login-card">
        <div className="login-brand">
          <Image
            alt="CineDark"
            height={72}
            priority
            src={appPath("/cinedark-logo.png")}
            width={72}
          />
          <span>PAINEL ADMINISTRATIVO</span>
        </div>
        <div className="login-heading">
          <span className="eyebrow">ACESSO RESTRITO</span>
          <h1 id="login-title">Entre na sua conta</h1>
          <p>Faça login para acessar e gerenciar o catálogo CineDark.</p>
        </div>
        <form className="login-form" onSubmit={handleSubmit}>
          <label htmlFor="admin-password">Senha administrativa</label>
          <input
            autoComplete="current-password"
            autoFocus
            id="admin-password"
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Digite sua senha"
            required
            type="password"
            value={password}
          />
          {error && <p className="login-error" role="alert">{error}</p>}
          <button
            className="button button-primary"
            disabled={isSubmitting || !password}
            type="submit"
          >
            {isSubmitting ? "Verificando..." : "Entrar com segurança"}
          </button>
        </form>
        <p className="login-security-note"><span aria-hidden="true">▣</span> Acesso protegido por sessão administrativa</p>
      </section>
    </main>
  );
}
