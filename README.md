# Desvios de Perfuração — Inclinação, Azimute e Profundidade

Dashboard estático (HTML/CSS/JS) que consome em tempo real a planilha Google Sheets
consolidada de furos perfurados e apresenta a aderência ao projeto conforme os parâmetros
da ferramenta **ANALISE DE DESVIOS DE INCLINAÇÃO E AZIMUTE** (OpenBlast):

| Parâmetro          | Esperado | Limites            | Tolerância |
| ------------------ | -------- | ------------------ | ---------- |
| Ângulo frontal     | 15°      | 12° a 18°          | ±3°        |
| Δ Azimute          | 0°       | −5° a +5°          | ±5°        |
| Δ Profundidade (Z) | 0,00 m   | −0,25 m a +0,25 m  | ±0,25 m    |
| Meta de aderência  | —        | mínimo 80% dos furos | —        |

## Publicação
- Deploy via GitHub Pages (branch `main`, raiz).
- Sem backend: os dados são lidos direto do Google Sheets via `gviz` (fallback CSV) a cada acesso.

## Fonte
Planilha pública US Vale Verde:
`https://docs.google.com/spreadsheets/d/1ef7edY0Yye6arldVfOUYDcjI4GvY6g5U/`
