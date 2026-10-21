# Desvios de Perfuração — Inclinação, Azimute e Profundidade

Dashboard estático (HTML/CSS/JS) que consome em tempo real a planilha Google Sheets
consolidada de furos perfurados e apresenta a aderência ao projeto conforme os
**parâmetros atuais do sistema**:

| Parâmetro          | Valor                                           |
| ------------------ | ----------------------------------------------- |
| Ângulo frontal     | 15° ± 3,2° (faixa 11,8° a 18,2°)                |
| Δ Azimute          | 0° ± 6,39°                                      |
| Δ Profundidade Medida (m) | 0,00 m ± 0,20 m (20 cm)                         |
| Meta de aderência  | mínimo 80% dos furos                            |

## Parâmetros de análise pela planilha

Os parâmetros (ângulo, tolerâncias e meta) são lidos da aba `PARAMETROS` da mesma
planilha, com as colunas `CHAVE` e `VALOR`:

| CHAVE | VALOR padrão | Significado |
| ----- | ------------ | ----------- |
| `ANGULO_ESPERADO` | 15 | ângulo frontal de projeto (°) |
| `ANGULO_TOLERANCIA` | 3,2 | tolerância do ângulo frontal (°) |
| `AZIMUTE_TOLERANCIA` | 6,39 | tolerância do Δ Azimute (°) |
| `PROFUNDIDADE_TOLERANCIA` | 0,20 | tolerância do Δ Profundidade (m) |
| `META_ADERENCIA` | 80 | meta mínima de aderência (%) |

Os valores são lidos a cada carregamento e a cada atualização de 30 segundos.
Se a aba não existir ou não puder ser lida, o site usa os valores padrão acima.
Use vírgula ou ponto como separador decimal.

## Publicação
- Deploy via GitHub Pages (branch `main`, raiz).
- Sem backend para o dashboard: os dados são lidos direto do Google Sheets via `gviz` (fallback CSV) a cada acesso.
- A geometria dos furos é lida do índice `DXF_INDEX` da mesma planilha. Esse índice é
  sincronizado automaticamente pelo Apps Script a partir da pasta pública `Holes - DXF`
  do Google Drive, com atualização programada a cada 5 minutos. O DXF é servido pelo
  proxy CORS-safe do mesmo Apps Script, pois o download direto do Drive não pode ser
  lido por um site estático em outro domínio.

## Atualização operacional sem commit

Depois da configuração inicial, o fluxo de atualização é:

1. Colocar ou substituir o arquivo `.dxf` na pasta `Holes - DXF` do Google Drive.
2. Atualizar a base de furos na planilha Google Sheets.
3. Aguardar até 5 minutos para o Apps Script atualizar a aba `DXF_INDEX`.
4. Manter o dashboard aberto: ele consulta o índice a cada 30 segundos e redesenha o
   mapa automaticamente quando um DXF novo ou substituído aparece. Recarregar também
   força uma consulta imediata.

Não é necessário fazer commit, push ou novo deploy do GitHub Pages para alterações
de dados e de DXF. O código publicado consulta a planilha e o arquivo atualizado
diretamente em cada carregamento e durante a sessão. A cópia local em `data/` permanece
como fallback de segurança caso o Drive fique indisponível.

### Configuração inicial do sincronizador

O projeto Apps Script está registrado em `integrations/google-drive-dxf-sync/Code.gs`.
Execute a função `setup()` uma única vez no editor do Apps Script, conceda as
permissões solicitadas e mantenha os arquivos do Drive compartilhados como
“Qualquer pessoa com o link”. Publique também o projeto como aplicativo web, executado
como o proprietário e acessível por qualquer pessoa, e coloque a URL `/exec` publicada
na constante `DXF_PROXY_URL` de `app.js`. A função cria o gatilho de 5 minutos e recria
a aba `DXF_INDEX` com as colunas `PLANO`, `ARQUIVO`, `FILE_ID`, `URL_DOWNLOAD`,
`ATUALIZADO_EM`, `STATUS` e `TAMANHO_BYTES`. Essa aba é gerenciada pelo script e
não deve ser editada manualmente.

O nome-base do DXF deve corresponder ao valor de `PLANO` na planilha. O alias
legado `PC53.dxf` → `PP53` já está configurado no sincronizador.

## Responsividade

- Celular (até 560 px): janela "Ver todos os planos" em tela cheia, um bloco por linha, botão a largura total e gráficos de planta com rolagem horizontal.
- Tablet (561 a 980 px): gráficos em coluna única e KPIs em duas colunas.
- Computador: layout completo, com largura máxima de 1440 px.
- TV (a partir de 1800 px): a página é ampliada em 30%; a partir de 2800 px, em 70%.

## Planta: collar previsto × realizado

O bloco "Aderência em planta" compara, em cada plano, o collar previsto com o collar realizado.

- **Previsto:** planilha `Planejado - Coordenadas Previstas dos Furos (XYZ)`, ID
  `180XzsGaAuYqcvyZyFUTpTHtdFu97o8jmBrahzwYkBV0`, na pasta do projeto no Google Drive.
  Use a aba `PLANEJADO` (o site lê a primeira aba) com as colunas `PLANO | Y | X | Z`.
  Uma linha por furo previsto. `PLANO` deve ser igual ao nome-base do DXF (`PC-22` para
  `PC-22.dxf`). Coordenadas no mesmo sistema e unidade (metros) dos DXF. A planilha precisa
  estar com acesso "Qualquer pessoa com o link", como a planilha principal.
- **Filtro obrigatório de correspondência:** antes de importar coordenadas para
  `PLANEJADO`, mantenha somente furos com correspondência única no DXF. Use o
  identificador do texto da camada `Number` associado ao ponto da camada `Hole`
  junto com a proximidade XY (até 2,0 m); não associe pelo número isolado, pois
  IDs podem se repetir entre projetos de origem. Remova linhas planejadas sem
  correspondência única para que elas não sejam desenhadas como anéis isolados.
- **PC651026 (18/10/2026):** a planilha foi reduzida de 508 para 124 furos
  correspondentes ao DXF, após verificação por ID e XY. O conjunto filtrado está
  em `data/PC651026-planejado-correspondente.tsv`; os registros detalhados da
  auditoria permanecem locais.
- **Realizado:** ponto do layer `Hole` de cada DXF do plano (mesma fonte do mapa).
- **PC651026 (21/10/2026):** fontes substituídas pelos arquivos fornecidos em
  `Nova pasta (5)`: 233 medições, 235 furos no DXF e 234 coordenadas previstas
  únicas. Há 33 IDs do DXF diferentes dos IDs do Projetado, associados por
  proximidade XY (máximo 1,382 m). Os IDs DXF 329 e 3338 correspondem à mesma
  posição prevista 329, mantida uma única vez. Os furos 57 e 3338 não possuem
  medição na análise e permanecem sem valores realizados inventados.
  Backups, hashes das fontes, correspondências e conferência das bases ficam
  em `output/PC651026/substituicao_20261021/`, fora da publicação.
- **Pareamento:** cada collar previsto é ligado ao realizado mais próximo em planta, um para
- **XY sem dado confiável:** se 95% ou mais dos collares pareados coincidem com o previsto (menos de 1 mm), o ponto `Hole` do DXF repete o previsto e o XY do plano não mede desvio. Nesse caso o XY fica como "sem dado confiável" (cinza no mapa, sem barra no gráfico, "—" no relatório), em vez de 100%.
  um, até 2,0 m (`COLLAR_MATCH_MAX` em `planta.js`).
- **Tolerâncias:** deslocamento XY (distância em planta) ≤ 2 × diâmetro projetado do furo,
  com o diâmetro da coluna `DIAMETRO` em milímetros (101,6 mm = limite de 0,2032 m; 127 mm =
  limite de 0,254 m; 139,7 mm = limite de 0,2794 m).
  Furos sem diâmetro usam 0,50 m (`COLLAR_TOL_XY`). Z: usa o desvio de profundidade do furo (Δ PROFUNDIDADE da planilha, real − previsto) com o mesmo limite de profundidade do site (±0,20 m por padrão, `LIMITS.depth`). A diferença de cota do collar não entra no cálculo de Z.
- **Dois mapas:** o bloco mostra dois mapas em planta do mesmo filtro, lado a lado (em tela estreita, um embaixo do outro): **Planta XY** (distância em planta) e **Planta Z** (desvio de profundidade do furo). Cada um tem seu botão "Ver todos os planos".
- **Cores (Planta XY):** verde, dentro da tolerância XY; vermelho, fora. **Cores (Planta Z):** verde, desvio de profundidade dentro de ±0,20 m; vermelho, fora; cinza, furo sem registro de profundidade no período. Nos dois, azul é realizado sem previsto correspondente (não entra no cálculo) e anel tracejado é previsto sem furo realizado.
- O botão "Ver todos os planos" de cada mapa abre uma janela com um bloco de planta por plano do filtro, colorido pelo eixo daquele mapa. Role a janela para ver todos; em cada plano, Ctrl + roda do mouse dá zoom e o arraste move.
- A janela "Ver todos os planos" tem os botões "Exportar PDF" e "Exportar imagem", que geram um documento do eixo da janela aberta (XY ou Z), com todos os planos do filtro e os gráficos XY e Z. Clicar fora da janela fecha. A barra de status só aparece em carregamento ou erro.
- Os filtros de ANO, MÊS e PLANO valem para o bloco. Sem filtro de período, os previstos sem
  furo realizado também aparecem.

## Fonte
Planilha pública US Vale Verde:
`https://docs.google.com/spreadsheets/d/1ef7edY0Yye6arldVfOUYDcjI4GvY6g5U/`
