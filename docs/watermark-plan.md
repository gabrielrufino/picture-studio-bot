# Plano — Marca d'água em lote (`/watermark`)

## Decisões fechadas

| Item | Decisão |
|---|---|
| Comando | `/watermark` |
| Branch | `feat/watermark`, criada a partir de `develop` |
| Fotos por operação — Free | 3 |
| Fotos por operação — Pro | 100 |
| Contagem no limite diário | 1 lote = 1 operação |
| Limite diário existente | 3 operações (Free) / 50 operações (Pro) |
| Posições | 1 a 4 cantos, escolhidos pelo usuário |
| Tamanho da marca | Automático, 10%, 20% ou 30% da largura da base |
| Fundo da marca | Idealmente transparente (PNG/WebP) |
| Formato de saída | Mesmo formato da imagem recebida |
| Envio do resultado | Sempre como documento, para preservar formato/transparência |
| Lote de saída | Álbuns de até 10 documentos |
| Encerramento do lote | Botão inline “Pronto” ou texto `/ready` |

### Limites finais

| Regra | Free | Pro |
|---|---:|---:|
| Fotos por operação | 3 | 100 |
| Operações por dia | 3 | 50 |
| Fotos por dia (teórico) | 9 | 5.000 |
| Tamanho por foto | 10 MB | 50 MB |
| Tamanho da marca | 10 MB | 50 MB |

> O limite teórico de 5.000 fotos/dia do Pro é consequência de 50 operações × 100 fotos. Se isso for excessivo no futuro, pode-se adicionar um teto diário de fotos separado. Não faz parte desta versão.

---

## 1. Fluxo do usuário

```text
/watermark
  │
  ├─ "Envie até N fotos. Toque em Pronto ou envie /ready."
  │
  ├─ Fotos/documentos base são acumulados (sem processar ainda)
  │    └─ valida MIME, formato suportado e tamanho
  │
  ├─ Pronto / /ready
  │    └─ "Agora envie a marca d'água como arquivo PNG/WebP"
  │
  ├─ Marca d'água (documento)
  │    ├─ valida imagem, formato e alpha
  │    └─ aviso se não tiver transparência
  │
  ├─ Cantos (inline, 1 a 4)
  │
  ├─ Tamanho (automático / 10% / 20% / 30%)
  │
  └─ Processa em blocos de 10
       ├─ 1 foto  → documento único
       ├─ 2–10    → álbum de documentos
       └─ 11–100  → vários álbuns de até 10
```

### Por que não usar `media_group_id`

O álbum é suportado, mas o fim do lote é explícito:

- botão inline **“✅ Pronto”** na primeira foto recebida;
- fallback por texto **`/ready`**;
- quando o limite é atingido, o bot envia outra mensagem com o botão “Pronto”.

Isso evita timers e a detecção frágil de fim de álbum, funcionando igualmente para álbuns e fotos soltas. O usuário pode enviar 10 álbuns de 10 fotos ou 100 fotos individuais.

---

## 2. Mudanças de infraestrutura

### 2.1 Rate limiter

Hoje o bot aceita **3 updates a cada 2 s**. Um lote de 100 fotos seria bloqueado.

Alterar em `src/config/bot.ts`:

```ts
limit({
  timeFrame: 10_000,
  limit: 150,
  // ...
})
```

Isso acomoda 100 fotos + botão Pronto + marca + callbacks de cantos/tamanho. O limite diário e o limite de fotos por operação continuam sendo a proteção real contra abuso.

### 2.2 `sequentialize`

Cada foto do álbum é um update separado. Sem serialização, dois updates podem ler a mesma sessão do Mongo e um sobrescrever o outro, perdendo `base_file_ids`.

Adicionar `sequentialize` do `@grammyjs/runner`, antes da sessão:

```ts
const getSessionKey = (ctx: CustomContext) =>
  (ctx.from?.id || ctx.chat?.id)?.toString()

bot.use(sequentialize(getSessionKey))

bot.use(session({
  // ...
  getSessionKey,
}))
```

Isso garante que os updates de um mesmo usuário sejam processados em ordem. É a solução recomendada pelo próprio Grammy para concorrência com sessão.

> Premissa: uma instância do bot. Se houver múltiplas réplicas, será necessário um lock distribuído.

---

## 3. Modelo de dados

### 3.1 Constantes

Em `src/config/constants.ts`:

```ts
export const PHOTOS_PER_OPERATION_LIMITS = {
  [PlanTypeEnum.Free]: 3,
  [PlanTypeEnum.Pro]: 100,
}

export const WATERMARK_MEDIA_GROUP_SIZE = 10 // máximo do Telegram por álbum
export const WATERMARK_MAX_PHOTOS =
  PHOTOS_PER_OPERATION_LIMITS[PlanTypeEnum.Pro]
```

### 3.2 Schemas

Em `src/schemas/index.ts`:

```ts
export const WatermarkCornerSchema = z.enum([
  'top-left',
  'top-right',
  'bottom-left',
  'bottom-right',
])

export const WatermarkScaleSchema = z.enum([
  'auto',
  'small',
  'medium',
  'large',
])

export const WatermarkStepSchema = z.enum([
  'collecting_bases',
  'awaiting_watermark',
  'positions',
  'scale',
])

export const WatermarkParamsSchema = z.object({
  step: WatermarkStepSchema.optional(),
  base_file_ids: z.array(z.string()).default([]),
  watermark_file_id: z.string().optional(),
  positions: z.array(WatermarkCornerSchema).default([]),
  scale: WatermarkScaleSchema.default('auto'),
  limit_warned: z.boolean().optional(),
  paths: z.array(z.string()).optional(),
})

export const WatermarkConfiguredParamsSchema =
  WatermarkParamsSchema.extend({
    base_file_ids: z.array(z.string()).min(1).max(WATERMARK_MAX_PHOTOS),
    watermark_file_id: z.string(),
  })

export const WatermarkProcessParamsSchema =
  WatermarkConfiguredParamsSchema.extend({
    positions: z.array(WatermarkCornerSchema).min(1),
  })
```

Adicionar `WatermarkParams` ao union de `SessionData`.

---

## 4. Handler

Novo arquivo `src/handlers/watermark.handler.ts`.

### 4.1 Eventos

- `'msg:photo'`
- `'msg:document'`
- `'msg:text'` — apenas para `/ready`
- `'callback_query'` — toggles, aplicar, tamanho, voltar, cancelar

**Não** definir `'message'`. No `src/index.ts`, o middleware genérico de `message` é registrado antes de `msg:document`; se o handler definir `message`, ele engole os documentos. O `msg:text` é seguro porque o `message` genérico chama `next()` quando o handler não tem evento `message`.

### 4.2 Coleta das fotos base

Em `'msg:photo'` e `'msg:document'`, quando `step === 'collecting_bases'`:

- `document`: exigir MIME de imagem suportado (`jpeg`, `png`, `webp`, `avif`, `tiff`). Rejeitar GIF/SVG/HEIC.
- `photo`: sempre JPEG.
- Aplicar `checkLimits` com o `file_size`.
- Se o limite de fotos da operação foi atingido:
  - avisar **uma única vez** (`limit_warned`);
  - Free: incluir CTA `/pro`;
  - Pro: apenas informar o limite de 100;
  - ignorar a foto.
- Caso contrário, adicionar `file_id` em `base_file_ids`.
- Na primeira foto aceita: enviar mensagem com o teclado inline “✅ Pronto”.
- Ao atingir exatamente o limite: enviar mensagem “Limite de N fotos atingido” também com o botão “Pronto”.

### 4.3 Encerrar o lote

Callback `watermark_ready` ou texto `/ready`:

- validar `base_file_ids.length >= 1`;
- revalidar o limite do plano (proteção contra mudança de plano/sessão adulterada);
- mudar `step` para `awaiting_watermark`;
- editar a mensagem removendo o teclado e pedindo a marca;
- no caso de `/ready`, responder com a mesma instrução.

### 4.4 Marca d'água

Em `step === 'awaiting_watermark'`:

- aceitar apenas `msg:document`;
- se vier foto, responder: “Envie a marca como arquivo (documento), não como foto, para preservar a transparência.”;
- validar MIME e formato;
- baixar uma vez, rodar `sharp.metadata()` para validar e checar `hasAlpha`, e apagar o temporário;
- guardar apenas `watermark_file_id`;
- mudar `step` para `positions`;
- enviar o teclado de cantos, incluindo o aviso de transparência quando `hasAlpha === false`.

### 4.5 Cantos

Callbacks `watermark_toggle_tl|tr|bl|br`:

- validar sessão com `WatermarkConfiguredParamsSchema`;
- alternar a posição;
- atualizar o teclado com `editMessageReplyMarkup`;
- mostrar `✅` ou `⬜` em cada botão.

Callback `watermark_apply`:

- se não houver nenhum canto, `answerCallbackQuery` com alerta;
- senão, `step = 'scale'` e editar a mensagem para o teclado de tamanho.

### 4.6 Tamanho

Callbacks `watermark_scale_auto|small|medium|large`:

- validar com `WatermarkProcessParamsSchema`;
- `answerCallbackQuery`;
- editar a mensagem para “Aplicando marca d'água...”;
- executar o processamento com `runWithUsage` — **um incremento por lote**.

`watermark_back` volta para cantos; `watermark_cancel` limpa a sessão.

---

## 5. Processamento em blocos

Para 100 fotos, processar tudo de uma vez consumiria muita memória/disco, e o Telegram só aceita 10 itens por álbum.

1. Baixar a marca d'água uma vez.
2. Dividir `base_file_ids` em blocos de **10**.
3. Para cada bloco:
   - processar cada foto sequencialmente;
   - baixar, validar, compor, encodar no formato original e escrever o temporário;
   - apagar o input imediatamente;
   - se uma foto falhar, registrar a falha e continuar;
   - se houver pelo menos um sucesso no bloco, enviar:
     - 1 resultado → `replyWithDocument`;
     - 2–10 resultados → `replyWithMediaGroup` com `InputMediaDocument`;
   - chamar `markDelivered()` no primeiro envio bem-sucedido;
   - apagar os outputs do bloco;
   - editar a mensagem de progresso: “Processando {done}/{total}...”;
   - pequena pausa entre blocos para evitar flood do Telegram.
4. No final:
   - se nenhuma foto foi processada, lançar `InvalidFileError` para o `runWithUsage` **estornar** o uso;
   - se houve falhas parciais, enviar um aviso com a quantidade;
   - editar a mensagem final: “✅ {success} de {total} fotos processadas.”

### 5.1 Composição por foto

A marca é dimensionada em relação à **largura de cada foto**, não do lote:

```ts
const ratio =
  scale === 'auto'
    ? 0.15
    : { small: 0.10, medium: 0.20, large: 0.30 }[scale]

const maxByHeight =
  Math.floor((baseH * 0.30) * (markW / markH))

const targetW = Math.max(1, Math.min(
  Math.round(baseW * ratio),
  maxByHeight,
  markW, // nunca amplia a marca
))

const targetH = Math.max(1, Math.round(markH * targetW / markW))
```

- `auto` = 15% da largura, com teto de 30% da altura.
- A proporção escolhida é um **teto**; a marca nunca é ampliada.
- Margem de ~2,5% do menor lado, com mínimo de 8 px e clamp para imagens pequenas.
- `autoOrient()` na base e na marca para respeitar EXIF.
- Formato de saída = formato real da base: `jpeg`, `png`, `webp`, `avif` ou `tiff`.
- Formatos não suportados são rejeitados na coleta ou ignorados no processamento.

### 5.2 Envio dos resultados

- 2–10 documentos: `ctx.replyWithMediaGroup([...])`.
- Cada item é `InputMediaDocument` com `new InputFile(path, 'watermarked-<n>.<ext>')`.
- Legenda apenas no primeiro item do álbum: “✅ Lote {chunk}/{chunks} processado.”
- 1 documento: `ctx.replyWithDocument(...)`.
- Blocos de 10 garantem o limite do Telegram e mantêm o disco controlado.

---

## 6. Arquivos afetados

| Arquivo | Mudança |
|---|---|
| `src/config/constants.ts` | limites de fotos por operação e tamanho do bloco |
| `src/config/bot.ts` | `sequentialize` + rate limit 150/10 s |
| `src/enums/command.enum.ts` | `Watermark` |
| `src/schemas/index.ts` | schemas/tipos de watermark |
| `src/interfaces/session-data.interface.ts` | incluir `WatermarkParams` |
| `src/handlers/watermark.handler.ts` | **novo** |
| `src/handlers/watermark.handler.spec.ts` | **novo** |
| `src/handlers/index.ts` | registrar handler |
| `src/messages/help.message.ts` | incluir watermark em `OPERATIONS` |
| `src/messages/help.message.spec.ts` | cobrir novo item |
| `src/utils/chunk.util.ts` | **novo** utilitário de blocos |
| `src/utils/chunk.util.spec.ts` | **novo** |
| `src/locales/en.json` | chaves de watermark |
| `src/locales/pt.json` | chaves de watermark |
| `src/locales/es.json` | chaves de watermark |
| `README.md` | feature, comando e limites |

Sem dependências novas.

---

## 7. Chaves de i18n

Adicionar em `en`, `pt` e `es`:

- `operation_watermark`
- `watermark_send_bases` (`{limit}`)
- `watermark_bases_hint`
- `watermark_ready_button`
- `watermark_ready_alert`
- `watermark_photo_limit_reached_free` (`{limit}`)
- `watermark_photo_limit_reached_pro` (`{limit}`)
- `watermark_send_mark`
- `watermark_mark_as_file`
- `watermark_no_transparency`
- `watermark_choose_positions`
- `watermark_position_top_left`
- `watermark_position_top_right`
- `watermark_position_bottom_left`
- `watermark_position_bottom_right`
- `watermark_select_at_least_one`
- `watermark_apply`
- `watermark_choose_scale`
- `watermark_scale_auto`
- `watermark_scale_small`
- `watermark_scale_medium`
- `watermark_scale_large`
- `watermark_processing` (`{total}`)
- `watermark_progress` (`{done}`, `{total}`)
- `watermark_batch_chunk` (`{chunk}`, `{chunks}`)
- `watermark_batch_summary` (`{success}`, `{total}`)
- `watermark_batch_summary_failures` (`{success}`, `{total}`, `{failed}`)
- `watermark_success`
- `watermark_invalid_file`
- `watermark_unsupported_format`
- `watermark_no_valid_photos`
- `watermark_error`
- `watermark_back`
- `watermark_cancel`
- `watermark_cancelled`

---

## 8. Testes

### Handler

- Coleta de 1, 3, 10 e 100 fotos.
- Free: 4ª foto gera aviso uma vez e é ignorada.
- Pro: 101ª foto gera aviso uma vez e é ignorada.
- `msg:document` com MIME inválido/GIF/SVG é rejeitado sem contar no limite.
- Primeira foto envia o botão “Pronto”.
- Ao atingir o limite, envia mensagem com “Pronto”.
- Callback “Pronto” sem fotos → alerta.
- `/ready` sem fotos → orientação.
- `/ready` com fotos → pede a marca.
- Marca como foto → pede para enviar como arquivo.
- Marca sem alpha → aviso.
- Toggles de cantos, aplicar sem canto, voltar, cancelar.
- Processamento:
  - 1 foto → documento único;
  - 2–10 → um álbum;
  - 11 → dois envios (10 + 1);
  - formatos mistos preservados;
  - falha parcial: envia os sucessos e avisa;
  - todas falham: erro + estorno de uso;
  - marca dimensionada por foto, não pelo lote;
  - progresso e resumo final;
  - `incrementUsage` uma vez por lote;
  - limpeza de inputs/outputs/marca e reset da sessão.

### Utilitário e help

- `chunk` com 0, 1, 10, 11 e 100 itens.
- Help inclui `operation_watermark`.

### Verificações

```bash
pnpm lint
pnpm build:check
pnpm test
```

### QA manual

- Free: 1, 3 e 4 fotos.
- Pro: 1, 10, 11 e 100 fotos, incluindo álbuns de 10.
- Fotos soltas + álbuns misturados.
- JPEG, PNG com alpha, WebP, AVIF, TIFF.
- Marca PNG transparente e marca JPEG opaca.
- Falha parcial e lote todo inválido.
- Rate limit com álbum grande.
- Reset via `/help` no meio do fluxo.

---

## 9. Ordem de implementação

1. `git switch develop && git pull --ff-only`
2. `git switch -c feat/watermark`
3. Constantes + utilitário `chunk`.
4. `sequentialize` + rate limiter.
5. Enum, schemas e tipo de sessão.
6. Locales `en/pt/es`.
7. Handler completo.
8. Registro no `handlers/index.ts` e `HelpMessage`.
9. README.
10. Testes.
11. `pnpm lint`, `pnpm build:check`, `pnpm test`.
12. QA manual com álbuns.
13. Commit — **somente com autorização**:

```text
feat(handlers): add batch watermark command with corner selection
```

---

## 10. Observações e riscos

- O Telegram Cloud API limita download via `getFile` a ~20 MB. O limite Pro de 50 MB já é um problema pré-existente para todas as operações.
- `sequentialize` é por processo. Múltiplas réplicas exigiriam lock distribuído.
- O rate limiter de 150/10 s é global; o limite diário e o de fotos por operação continuam protegendo contra abuso.
- O envio de 100 fotos gera 10 álbuns de documentos. Uma pequena pausa entre blocos evita flood do Telegram.
- O processamento é sequencial por foto para limitar memória. O disco fica limitado a um bloco de até 10 outputs.
- A marca nunca é ampliada; se for menor que a proporção escolhida, permanece no tamanho natural.
- Não há remoção automática de fundo da marca nesta versão.
- Formatos GIF animado, SVG e HEIC/HEIF não são suportados nesta versão.
