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
- Sem backend para o dashboard: os dados são lidos direto do Google Sheets via `gviz` (fallback CSV) a cada acesso.
- A geometria dos furos é lida do índice `DXF_INDEX` da mesma planilha. Esse índice é
  sincronizado automaticamente pelo Apps Script a partir da pasta pública `Holes - DXF`
  do Google Drive, com atualização programada a cada 5 minutos.

## Atualização operacional sem commit

Depois da configuração inicial, o fluxo de atualização é:

1. Colocar ou substituir o arquivo `.dxf` na pasta `Holes - DXF` do Google Drive.
2. Atualizar a base de furos na planilha Google Sheets.
3. Aguardar até 5 minutos para o Apps Script atualizar a aba `DXF_INDEX`.
4. Reabrir ou recarregar o dashboard publicado.

Não é necessário fazer commit, push ou novo deploy do GitHub Pages para alterações
de dados e de DXF. O código publicado consulta a planilha e o arquivo atualizado
diretamente em cada carregamento. A cópia local em `data/` permanece como fallback
de segurança caso o Drive fique indisponível.

### Configuração inicial do sincronizador

O projeto Apps Script está registrado em `integrations/google-drive-dxf-sync/Code.gs`.
Execute a função `setup()` uma única vez no editor do Apps Script, conceda as
permissões solicitadas e mantenha os arquivos do Drive compartilhados como
“Qualquer pessoa com o link”. A função cria o gatilho de 5 minutos e recria a aba
`DXF_INDEX` com as colunas `PLANO`, `ARQUIVO`, `FILE_ID`, `URL_DOWNLOAD`,
`ATUALIZADO_EM`, `STATUS` e `TAMANHO_BYTES`. Essa aba é gerenciada pelo script e
não deve ser editada manualmente.

O nome-base do DXF deve corresponder ao valor de `PLANO` na planilha. O alias
legado `PC53.dxf` → `PP53` já está configurado no sincronizador.

## Fonte
Planilha pública US Vale Verde:
`https://docs.google.com/spreadsheets/d/1ef7edY0Yye6arldVfOUYDcjI4GvY6g5U/`
