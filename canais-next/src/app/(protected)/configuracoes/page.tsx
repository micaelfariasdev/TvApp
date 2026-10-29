import { AdminShell } from "@/components/admin-shell";

export default function SettingsPage() {
  return (
    <AdminShell>
      <div className="page-content">
        <div className="catalog-page-heading">
          <div>
            <span className="eyebrow">PAINEL</span>
            <h1>Configurações</h1>
            <p>A leitura do catálogo já usa a API v2; o acesso de escrita reutiliza a senha administrativa do Express.</p>
          </div>
        </div>
        <section className="settings-preview">
          <span className="settings-icon">⚙</span>
          <h2>Configurações do servidor</h2>
          <p>
            Cadastros e edições são enviados ao Express depois do login. As
            configurações de home, HLS e demais opções do servidor continuam
            sendo administradas no painel atual.
          </p>
          <span className="settings-status"><span className="status-pulse" /> Em preparação</span>
        </section>
      </div>
    </AdminShell>
  );
}
