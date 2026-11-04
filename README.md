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

Limites exclusivos: valor exatamente igual ao limite fica fora ("Não"). Ângulo: faixa aberta entre 11,8° e 18,2°. Azimute e profundidade: |Δ| menor que o limite.

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

1. Colocar ou substituir o arquivo `.dxf` na pasta `Holes - DXF` do Google Drive, com o nome `<PLANO>.dxf` (PLANO igual ao da planilha principal; ex.: `PP53.dxf`).
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

O nome-base do DXF deve corresponder ao valor de `PLANO` na planilha (`<PLANO>.dxf`, ex.: `PP53.dxf`). O alias legado `PC53.dxf` → `PP53` continua no código, mas não é mais necessário: o arquivo foi renomeado em 04/11/2026.

## Responsividade

- Celular (até 560 px): janela "Ver todos os planos" em tela cheia, um bloco por linha, botão a largura total e gráficos de planta com rolagem horizontal.
- Tablet (561 a 980 px): gráficos em coluna única e KPIs em duas colunas.
- Computador: layout completo, com largura máxima de 1440 px.
- TV (a partir de 1800 px): a página é ampliada em 30%; a partir de 2800 px, em 70%.

## Planta: collar previsto × realizado

O bloco "Aderência em planta" compara, em cada plano, o collar previsto com o collar realizado.

- **Previsto:** planilha `Planejado - Coordenadas Previstas dos Furos (XYZ)`, ID
  `1dfZD8SdNN1zKcrRMMoTsBDtYP0gxYr9b`, na pasta do projeto no Google Drive.
  Use a primeira aba com as colunas `PLANO | Y | X | Z | DIAMETRO | ID`. O ID está disponível para rastreabilidade; atualmente o pareamento no dashboard usa proximidade XY.
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
- **PC651026, linhas na planilha:** principal, linhas 1704–1936 (233 medições); PLANEJADO, linhas 1884–2117 (234 previstos, 228 com ID).
- **Pareamento:** cada collar previsto é ligado ao realizado mais próximo em planta, um para um, até 2,0 m (`COLLAR_MATCH_MAX` em `planta.js`).
- **XY sem dado confiável:** se 95% ou mais dos collares pareados coincidem com o previsto (menos de 1 mm), o ponto `Hole` do DXF repete o previsto e o XY do plano não mede desvio. Nesse caso o XY fica como "sem dado confiável" (cinza no mapa, sem barra no gráfico, "—" no relatório), em vez de 100%.
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

## Mapa 3D

O mapa 3D (bloco "Mapa de execução") usa o mesmo pareamento da planta:

- **Emboque previsto (anel cinza):** collar do PLANEJADO pareado ao realizado. X e Y vêm do previsto; Z é o do collar realizado do mesmo furo. Assim o previsto fica na altura do realizado e a diferença aparece só no plano XY. Sem par, o anel fica no início do furo teórico.
- **Tubo previsto (cinza, semitransparente):** linha teórica do DXF (camada `THEORETICAL HOLE`), com o início no emboque previsto pareado.
- **Emboque realizado (esfera azul):** ponto da camada `HOLE` do DXF. Sem ponto, usa o início do executado; nunca o previsto. Com os furos ocultos, cada emboque vira um círculo achatado no chão.
- **Linha previsto × realizado:** aparece quando a distância passa de 0,10 m (`COLLAR_LINK_MIN` em `map3d.js`).
- A legenda da página mostra só Planejado, Executado e Emboque; o anel e a esfera ainda não têm item próprio.

## Pendências de dados

Itens da conferência de 04/11/2026. Nenhum foi corrigido na planilha: cabe ao responsável pelos dados.

1. **Flags de limite na planilha.** Nos valores exatamente no limite, a coluna "dentro do limite" não segue uma regra única. Δ Profundidade = +0,20 m: 10 "Sim" e 7 "Não"; = −0,20 m: 13 "Sim" e 12 "Não"; ângulo = 18,2°: 4 "Sim" e 1 "Não". O site aplica a regra estrita (no limite = "Não"). Recalcular essas flags pela mesma regra.
2. **PC-23B e PC-23C.** 48 linhas com `Data` = 19/06/2026, mas `Ano` = 2026 e `Mês` = 4 (abril). O site usa `Data`, então elas aparecem em junho. Confirmar a data correta.
3. **PC-24.** 191 de 193 linhas sem azimute planejado e sem Δ Azimute (ficam fora do KPI de azimute).
4. **Δ Azimute fora de escala.** PC-14, IDs 108–126: entre −95,4° e +107,9°. PC651026, ID 380: −147,93°. Conferir se é erro de leitura ou de furo.
5. **Ângulos muito baixos** (projeto 15° ± 3,2°). PC-14, IDs 105–129: 0,4° a 8,2°. PC-24, IDs 79–86: 0,2° a 1,6°. PC-44, IDs 801–814: 0,3° a 5,5°. Conferir a leitura do ângulo.
6. **Collar do DXF igual ao previsto** (o ponto `Hole` repete o previsto): PC-09, PC-14, PC-15, PC-19, PC-23B, PC-23C, PC-24, PC-31, PC-35, PC-38.
7. **PC-22 e PC22B.** Mesmas coordenadas no PLANEJADO (30 linhas cada, idênticas). Confirmar se são o mesmo fogo ou se uma das duas é cópia.
8. **PC-23 (`PC-23.dxf`).** Existe no Drive e em `data/`, mas não tem linhas na planilha principal; por isso não aparece nos filtros.
9. **`PC651026.dxf`** não está na pasta Drive (04/11/2026). O site usa `data/PC651026.dxf`. Subir ao Drive se o arquivo tiver de estar na fonte.
10. **PLANEJADO, PC651026.** 6 de 234 linhas sem `ID` (coluna F).

## Fonte
Planilha pública US Vale Verde:
`https://docs.google.com/spreadsheets/d/1ef7edY0Yye6arldVfOUYDcjI4GvY6g5U/`
