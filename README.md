# Desvios de Perfuração — Inclinação, Azimute e Profundidade

Dashboard estático (HTML/CSS/JS) que consome em tempo real a planilha Google Sheets
consolidada de furos perfurados e apresenta a aderência ao projeto conforme os
**parâmetros atuais do sistema**:

| Parâmetro          | Valor                                           |
| ------------------ | ----------------------------------------------- |
| Ângulo frontal     | 15° ± 3,2° (faixa 11,8° a 18,2°)                |
| Δ Azimute          | 0° ± 6,39°                                      |
| Δ Profundidade (Z) | 0,00 m ± 0,20 m (20 cm)                         |
| Meta de aderência  | mínimo 80% dos furos                            |

## Publicação
- Deploy via GitHub Pages (branch `main`, raiz).
- Sem backend: os dados são lidos direto do Google Sheets via `gviz` (fallback CSV) a cada acesso.

## Fonte
Planilha pública US Vale Verde:
`https://docs.google.com/spreadsheets/d/1ef7edY0Yye6arldVfOUYDcjI4GvY6g5U/`
