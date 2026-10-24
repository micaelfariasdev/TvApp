import json
import re
import time
import urllib.request
import urllib.error

# Nome do arquivo JSON de entrada e o de saída
input_file = "input.json"
output_file = "output_json_atualizado.json"

def get_final_url(url):
    """
    Acessa a URL, segue os redirecionamentos HTTP e retorna a URL final obtida.
    """
    try:
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)"}
        )
        with urllib.request.urlopen(req, timeout=10) as response:
            return response.url
    except urllib.error.HTTPError as e:
        print(f"Erro HTTP {e.code} na URL: {url}")
        return url
    except Exception as e:
        print(f"Erro ao conectar na URL {url}: {e}")
        return url

def clean_name(name):
    """
    Remove o padrão de temporadas e episódios (ex: S01E01) do nome.
    """
    cleaned = re.sub(r'\s+[sS]\d{2}[eE]\d{2}.*', '', name)
    return cleaned.strip()

def main():
    try:
        with open(input_file, "r", encoding="utf-8") as f:
            data = json.load(f)
    except FileNotFoundError:
        print(f"Arquivo '{input_file}' não encontrado. Crie o arquivo com o JSON antes de rodar.")
        return

    channels = data.get("channels", [])
    total = len(channels)
    print(f"Total de canais/links encontrados: {total}\nProcessando...")

    for i, channel in enumerate(channels, start=1):
        original_name = channel.get("name", "")
        old_url = channel.get("url", "")

        print(f"[{i}/{total}] Processando: {original_name}")

        channel["name"] = clean_name(original_name)

        if old_url:
            final_url = get_final_url(old_url)
            if final_url != old_url:
                print(f"  Redirecionado para: {final_url}")
            channel["url"] = f'http://164.152.62.129/api/hls-proxy?url={final_url}'

        if i < total:
            print("Aguardando 10 segundos para a próxima requisição...")
            time.sleep(10)

    with open(output_file, "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, indent=2)

    print(f"\nProcesso concluído! Novo JSON salvo em: {output_file}")

if __name__ == "__main__":
    main()