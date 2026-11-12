# CLAUDE.md — Pipeline de alimentação do dashboard QAQC - Perfuração

Este arquivo orienta qualquer IA que for adicionar um **plano de fogo novo** ao
dashboard de desvios de perfuração (Enaex / US Vale Verde). Leia tudo antes de
mexer em planilhas ou no repositório.

## Preferência do usuário (execução)

- O trabalho operacional deve ser feito com **Haiku 5.5, esforço médio**.
- **Opus só orquestra**: planeja, delega e revisa; não executa as etapas de dados.

## 0. Rotina completa (começar aqui)

A rotina de atualização (DXF + Projetado + análise de desvios → planilha principal, PLANEJADO, Drive e site) está documentada na pasta de trabalho:
`C:\Users\ferre\OneDrive\Documentos\PROJETOS PROGRAMAÇÃO\01. ENAEX\00_FERRAMENTAS\REPORTS\ATUALIZAR BASES DE DADOS QAQC PERFURAÇÃO\README.md` (e o `CLAUDE.md` de lá, com os scripts em `scripts/`).

Este repositório só precisa de commit quando muda `data/` (DXF de fallback e `data/dxf-manifest.json`) ou código. Ao alterar um `.js` publicado, incrementar o `?v=` correspondente em `index.html`.

## 1. Entradas recebidas por plano

Para cada plano (ex.: `PC651026`) chegam três arquivos:

| Arquivo | Conteúdo |
| --- | --- |
| `analise-desvios-<plano>.xlsx` | Aba `Base calculada`: 1 linha por furo (Plano, ID, Ângulo frontal, Azimute planejado/executado, Δ Azimute, Profundidade planejada/executada, Δ Profundidade, três colunas "dentro do limite"). Aba `Resumo` com indicadores. |
| `<plano> Projetado.xlsx` | Aba `PROJETO PERFURAÇÃO`: planejamento de todos os furos da malha (colunas `Data`, `ID`, `Project`, `Diameter` em polegadas, `X Collar`, `Y Collar`, `Z Collar`, etc.). Pode conter **vários planos misturados**. |
| `<plano>.dxf` | Geometria: layers `Hole` (POINT, collar realizado), `Real Hole` (POLYLINE), `Theoretical Hole` (LINE), `Number` (TEXT com o ID do furo). |

Os arquivos de origem ficam fora do repositório (pasta de anotações do usuário). **Nunca altere os originais**; copie-os.

## 2. Google Sheets e Drive

| Recurso | ID / URL | Uso |
| --- | --- | --- |
| Planilha principal de desvios (`Inclinação_Azimute_Profundidade.xlsx`, abre como Sheets) | `1ef7edY0Yye6arldVfOUYDcjI4GvY6g5U` | Aba `Inclinação_Azimute_Profundidade` (dados) e aba `DXF_INDEX` (gerada pelo Apps Script; **não editar à mão**). |
| Planilha de coordenadas previstas (`Planejado - Coordenadas Previstas dos Furos (XYZ)`) | `1dfZD8SdNN1zKcrRMMoTsBDtYP0gxYr9b` | Aba **`PLANEJADO`** (a primeira aba; o site lê a primeira aba; arquivo .xlsx lido via gviz). A cópia antiga (outro ID) foi para a lixeira em 04/11/2026: não usar. |
| Pasta Drive `Holes - DXF` | `1H2UP4hW77YYiwZqvfxjnFt3_DahNnBQI` (`https://drive.google.com/drive/folders/1H2UP4hW77YYiwZqvfxjnFt3_DahNnBQI`) | DXFs que o Apps Script sincroniza a cada 5 min (`folderId` em `Code.gs`). É filha da pasta `1_by9dFzsv3vW4Zb9YKb-QnOIjXwdoe-4` (que guarda as planilhas), não a própria pasta dos DXFs. |

### 2.1 Aba principal (`Inclinação_Azimute_Profundidade`)

- Colunas, nesta ordem (A a O): `Plano | ID | Ângulo frontal (°) | Azimute planejado (°) | Azimute executado (°) | Δ Azimute (°) | Profundidade planejada (m) | Profundidade executada (m) | Δ Profundidade (m) | Ângulo dentro do limite | Azimute dentro do limite | Z dentro do limite | Ano | Mês | Data`.
- Cabeçalho na linha 1; dados começam na linha 2. **Última linha com dados:** localizar pela coluna A (a planilha tem formatação até a linha ~101114; não usar `max_row`).
- `Plano`: texto no mesmo nome-base do DXF (ex.: `PC-09`, `PP391026`, `PC651026`).
- `ID`: número inteiro (como float).
- Valores numéricos com ponto decimal, formato geral.
- `Ano` e `Mês`: **fórmulas** `=YEAR(O<linha>)` e `=MONTH(O<linha>)`, referenciando a coluna `Data`.
- `Data`: data real (ex.: `2026-10-09`). Dentro dos arquivos de origem, a data do plano vem da coluna `Data` do `<plano> Projetado.xlsx` (não da data de geração da análise). O app usa a `Data` como fonte temporal; `Ano/Mês` são fallback.
- `Dentro do limite`: texto `Sim` / `Não`.

### 2.2 Aba `PLANEJADO`

- Colunas: `PLANO | Y | X | Z | DIAMETRO | ID`. Uma linha por furo previsto. A coluna `ID` (F) é o ID do furo, para rastreio; o pareamento com o realizado é por XY (até 2,0 m), não pelo ID. Em 04/11/2026, 6 das 234 linhas do PC651026 estão sem `ID`.
- Estado atual do PC651026 (após a substituição de 21/10/2026): 234 linhas, na faixa 1884–2117.
- `PLANO` = nome-base do DXF (ex.: `PC651026`).
- `Y` e `X`: `Y Collar` e `X Collar` do Projetado (metros, 2 casas decimais, formato `#,##0` na planilha, valor numérico).
- `Z`: `Z Collar` do Projetado.
- `DIAMETRO`: **em milímetros**. O Projetado traz **polegadas**: converter (4" → 101.6; 5" → 127.0; 5½" → 139.7). Não copiar o número bruto.
- **Filtrar o Projetado pelos códigos do plano.** Um Projetado pode conter vários blasts. Para `PC651026`, foram usados as linhas com `Project = PP0651026` (500 linhas) **mais** os IDs 395–402, que aparecem com `Project = PP0601026` mas pertencem geometricamente ao mesmo fogo. Confirmar sempre com a análise (IDs da aba `Base calculada`) e com o DXF (textos `Number`).

## 3. Repositório e fallback do DXF

- Repositório publicado no GitHub Pages (branch `main`, raiz). **Tudo na raiz é publicado.**
- `data/<plano>.dxf`: cópia local de fallback do DXF (o app busca aqui se o Drive falhar). Nome exatamente igual ao plano (ex.: `data/PC651026.dxf`).
- **Nome do DXF: `<PLANO>.dxf`**, com `PLANO` igual à coluna `Plano` da planilha principal (ex.: `PP53.dxf`, não `PC53.dxf`). O `Code.gs` usa o nome do arquivo, sem `.dxf` e em maiúsculas, como `PLANO` em `DXF_INDEX`. Renomear só o título no Drive (mesmo `FILE_ID`) basta: o índice atualiza na sincronização de até 5 min. Não editar `DXF_INDEX` à mão.
- Cópias em `data/` (manifesto com 25 planos): os 24 planos com DXF na pasta Drive, mais `PC651026.dxf`, que existe só em `data/` (não está no Drive em 04/11/2026). `PC55`, `PC56B`, `PC59` e `PP391026` foram incluídos em 04/11/2026, baixados do Drive com o mesmo tamanho em bytes.
- `data/dxf-manifest.json`: lista JSON de planos com DXF local. **Incluir o novo plano** (ordem alfabética aproximada, inserir antes de `PP53` etc.). Se o plano não estiver no manifesto, o app não busca o arquivo local.
- **Nunca commitar xlsx** (nem análise, nem Projetado): o repositório é público e os arquivos seriam servidos pelo Pages. Não criar pastas com planilhas no repositório.
- Não commitar `.playwright-mcp/` nem `output/`.

## 4. Como o site carrega os dados

- `app.js`: lê a aba principal via `gviz` (`SHEET_ID = 1ef7…`), com fallback CSV. Recarrega a cada acesso e a cada atualização periódica.
- `app.js` → `DXF_INDEX`: lê a aba `DXF_INDEX` (gerada pelo Apps Script `integrations/google-drive-dxf-sync/Code.gs`), que lista os arquivos da pasta `Holes - DXF`. Cada DXF é servido pelo proxy do Apps Script (`DXF_PROXY_URL`).
- `planta.js`: lê a aba `PLANEJADO` da planilha `1dfZD8SdNN…` (`PLANEJADO_SHEET_ID`) via `gviz` (primeira aba). Os previstos são pareados com o collar realizado do DXF.
- Filtros (`filter-year`, `filter-month`, `filter-plan`) são montados a partir dos **registros que existem** na aba principal. **Se o plano não tiver linhas nessa aba, ele não aparece em nenhum filtro**, mesmo com DXF e PLANEJADO prontos.
- Mês: o app usa a coluna `Data` (`dt.getMonth()+1`) como fonte; `Ano/Mês` só são usados quando `Data` está vazia. Janela no código (`app.js`, `MIN_YM` = nov/2025): registros anteriores são ignorados. Não existe mais mês excluído: o antigo corte fixo de nov/2026 (`SKIP_YM`) escondia o plano PC611126_B (03/11/2026) e foi removido em 12/11/2026.
- Os DXFs são lidos de `DXF_INDEX` (Drive) quando existem; senão, do `data/<plano>.dxf` do repositório.
- Não é necessário commit para atualizar dados da planilha ou do Drive. Commit só é necessário para `data/` (fallback e manifesto) ou para mudanças de código.
- **Dentro/fora do limite: a flag da planilha é a fonte de verdade.** As colunas `Ângulo dentro do limite`, `Azimute dentro do limite` e `Z dentro do limite` (`Sim` / `Não`) definem a conta em KPIs, gráficos, planta, relatório e Excel. Se a flag estiver vazia ou `N/A` e houver valor, vale a regra numérica estrita dos `LIMITS` (ângulo entre 11,8° e 18,2° sem os extremos; `|Δ Azimute| < 6,39°`; `|Δ Profundidade| < 0,20 m`). Sem flag e sem valor, o furo fica fora da conta (`N/A`, fora do denominador, como antes). Histogramas usam os `LIMITS` só para colorir as faixas. Funções em `app.js`: `angleInside`, `azInside`, `zInside`. Flags no valor exato do limite: ver README, Pendências de dados.
- **Mapa 3D (`map3d.js`):** emboque previsto = collar do PLANEJADO pareado ao realizado (X/Y do previsto, Z do realizado do mesmo furo); tubo previsto = linha teórica do DXF com início no emboque previsto; realizado = esfera azul. Detalhes no README, seção Mapa 3D.

## 5. Como anexar linhas nas planilhas (método que funcionou)

Ordem recomendada:

### 5.1 Geração reproduzível dos TSVs (PC651026 como exemplo)

Estado atual do PC651026 (após a substituição de 21/10/2026): principal com 233 linhas (1704–1936) e PLANEJADO com 234 linhas (1884–2117). Os números abaixo são do primeiro ciclo (18/10), mantidos como histórico.

Use `python -X utf8 -I` (o `-I` ignora variáveis `PYTHON*`; `-X utf8` evita erro de acento no console). Não rodar scripts dentro da pasta dos arquivos de origem.

**Principal (`main_append.tsv`)**
- Fonte: aba `Base calculada` de `analise-desvios-<plano>.xlsx`, linhas com `ID` preenchido (cabeçalho na linha 1).
- Colunas A a L, mapeamento direto e na mesma ordem: `Plano, ID, Ângulo frontal, Azimute planejado, Azimute executado, Δ Azimute, Profundidade planejada, Profundidade executada, Δ Profundidade, Ângulo dentro, Azimute dentro, Z dentro`.
- M: `=YEAR(O<linha>)`; N: `=MONTH(O<linha>)`; O: data do plano (`2026-10-09` para PC651026, vinda da coluna `Data` do Projetado).
- Linha de destino: **última linha com dados + 1**. Para PC651026: `1704`, pois a última linha com coluna A preenchida é a `1703`. Verificar pela coluna A, não por `max_row`.
- Sem separador de milhar; ponto decimal. Resultado: 123 linhas.

**PLANEJADO (`planejado_append.tsv`)**
- Fonte: aba `PROJETO PERFURAÇÃO` de `<plano> Projetado.xlsx`, linhas com `ID` preenchido.
- Filtro: `Project == 'PP0651026'` **ou** `ID` entre 395 e 402 (IDs que aparecem como `PP0601026`, mas pertencem ao fogo; confirmar com a análise). Resultado: 508 linhas (500 + 8).
- Colunas: `PLANO = PC651026` (fixo, nome-base do DXF); `Y = Y Collar`; `X = X Collar`; `Z = Z Collar`; `DIAMETRO` = `Diameter` convertido para mm (5 polegadas → `127`; 4 → `101.6`; 5½ → `139.7`). Não copiar o valor bruto.
- Números com 2 casas decimais, sem separador de milhar.
- Linha de destino: **última linha de dados + 1**. Para PC651026: `1884` (a última com coluna A preenchida é a `1883`). Resultado: linhas 1884 a 2391.

### 5.2 Passos de colagem

1. Gerar os TSVs (5.1). Principal: 123 linhas, 15 colunas. PLANEJADO: linhas `PLANO, Y, X, Z, DIAMETRO`.
2. Servir a pasta dos TSVs localmente (`python -m http.server <porta> --directory <pasta>`) e abrir uma página de cópia que faz `fetch` do TSV e chama `navigator.clipboard.writeText` ao clicar num botão.
3. Abrir a planilha em uma **aba nova** no Chrome, ir à célula inicial (Caixa de Nome → `A1704` na principal, `A1884` na PLANEJADO) e colar com Ctrl+V.
4. Conferir: número de linhas, colunas nos lugares certos, fórmulas em `M/N`, formato de data em `O`.
5. Validar pela leitura pública: `curl` no `gviz/tq?tqx=out:json&headers=1` e checar as linhas novas.

**O que NÃO funcionou:**
- Drive MCP (`update_file`, `create_file`) não altera o conteúdo de planilhas nem de arquivos existentes. Só título, pasta e descrição.
- Abrir o `.xlsx` original no Drive e converter para Sheets cria um arquivo novo (ID diferente). **Não converter**; usar a planilha de ID fixo.

**Bloqueio observado:** o classificador de segurança do Claude Code bloqueou chamadas do Chrome com as mensagens "Modify Shared Resources" e "External System Writes". Escritas em planilhas compartilhadas e em pastas do Drive exigem **autorização explícita do usuário no chat**, na mesma sessão, e podem ser bloqueadas de novo. Não contornar o bloqueio com outra ferramenta; parar e explicar ao usuário, ou o usuário faz a colagem manualmente com os TSVs.

**Autorização registrada (PC651026):** o usuário autorizou explicitamente todas as escritas (planilhas `1ef7…` e `1dfZ…` (PLANEJADO), pasta `Holes - DXF`) e declarou, no chat, que é o responsável por elas. Essa autorização vale para o ciclo PC651026; para um novo plano, pedir nova autorização explícita. Em 04/11/2026 o usuário autorizou a renomeação `PC53.dxf` → `PP53.dxf` na pasta `Holes - DXF`, a cópia de DXFs para `data/` e commit/push.

## 6. Checagens de dados antes de publicar

- Confirmar que a aba `Base calculada` tem o mesmo número de furos do DXF (aba `Number`). Diferença deve ser explicada (ex.: furo 57 existe no DXF e não na análise; provavelmente não medido).
- Confirmar que os IDs da análise existem no Projetado filtrado (todos os IDs da análise devem estar no conjunto selecionado).
- Verificar códigos misturados no Projetado (`Project` diferente do plano) e relatar.
- Verificar diâmetro: todas as linhas devem ter a mesma polegada, senão checar.
- Confirmar que as datas estão no mês esperado (ex.: 2026-10-09 para outubro/2026).
- Não sobrescrever linhas existentes; sempre anexar no fim da última linha de dados.

## 7. Commit, push e deploy

```bash
git add data/<plano>.dxf data/dxf-manifest.json
git commit -m "feat: adiciona plano <plano> (<mês>/<ano>) com DXF e manifesto"
git push origin main
gh run list --limit 1
gh run watch <run-id> --exit-status
```

Depois do deploy, conferir a URL pública:
`https://silvathiagoferreira.github.io/desvios-inclinacao-azimute-us-vale-verde/`
e `data/<plano>.dxf` e `data/dxf-manifest.json` (HTTP 200).

Ao alterar um `.js` publicado, subir o `?v=` do script em `index.html`; sem isso o navegador pode manter a versão antiga.

## 8. Verificação no dashboard

1. Abrir o site em aba nova com recarga forçada.
2. Conferir o filtro **Mês = Outubro** e **Ano = 2026**, e o plano em `filter-plan`.
3. Conferir tabela, KPIs, planta XY/Z (que depende de `PLANEJADO`) e o DXF renderizado.
4. Capturar screenshots; checar o console (erros de `gviz`, de `DXF` ou de parsing).

## 9. Lições do último ciclo (PC651026)

- O site **não** lê o plano do repositório: só o DXF e o manifesto vêm do repositório. Adicionar só o DXF não faz o plano aparecer nos filtros.
- Plano de novembro/2026 sumia do site sem erro por causa do corte fixo `SKIP_YM` (removido em 12/11/2026). Ao checar o site, conferir no console `RECORDS` (registros por plano) e a lista do filtro de planos, não só a tela.
- Planilhas em pt-BR: número colado com ponto (`11.26`) vira TEXTO; colar com vírgula (`11,26`). Ver a pasta de trabalho.
- A tabela principal é a fonte dos filtros. Sem linhas nela, o plano não aparece, mesmo com `PLANEJADO` completo.
- `Projetado.xlsx` mistura blasts; filtrar pelos códigos e confirmar pelos IDs da análise.
- `Diameter` do Projetado está em polegadas; a planilha `PLANEJADO` usa milímetros.
- A aba `DXF_INDEX` é gerada pelo Apps Script; não editar à mão.
- Publicar planilhas ou xlsx no repositório é proibido (repositório público).
- Dentro/fora: a flag `Sim`/`Não` da planilha manda; o numérico só entra quando a flag está vazia ou N/A e há valor. Flags no valor exato do limite: ver README, Pendências de dados.
- Pendências de dados para o usuário: ver `README.md`, seção **Pendências de dados**.
