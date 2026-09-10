# Vídeos para modelar

Site pessoal para guardar links de vídeos (TikTok, Instagram, Facebook, YouTube e outros) com a capa,
plataforma, status ("para modelar" / "modelado"), etiquetas e anotações.

- **Site**: https://modelar-videos.vercel.app (Vercel, equipe "burel", projeto `modelar`; alias automático `modelar-umber.vercel.app`)
- **API**: https://fbmtuwnakzzfdyemlhcg.supabase.co/functions/v1/videos (Supabase Edge Function `videos`)
- **Código**: https://github.com/Gaburelll/modelar (o GitHub Pages foi desativado; o repositório é só o código)

## Onde roda

- **Vercel** serve só a tela (pasta `docs/`, site estático, sem build). Configuração em `vercel.json`.
- **Supabase**, projeto `maker` (`fbmtuwnakzzfdyemlhcg`, região São Paulo), org "ycoldyyx@gmail.com's Org".
  - Edge Function `videos` (acesso público, protegida por PIN próprio; CORS liberado).
  - Tabelas `public.modelar_videos` e `public.modelar_settings` (RLS ligado, só a função acessa).
  - Bucket público `modelar-thumbs` com uma cópia de cada capa.
- O Supabase não deixa servir HTML pelo domínio supabase.co, por isso a tela fica separada da API.

## Estrutura

```
docs/index.html                     tela do site (HTML + CSS + JS, sem dependências)
docs/manifest.webmanifest           para "Adicionar à tela de início" no celular
docs/icon.svg, docs/icon-192.png    ícones
vercel.json                         hospedagem da pasta docs/ na Vercel
build.mjs                           desenha o icon-192.png (sem dependências)
supabase/functions/videos/index.ts  API: busca de capas, PIN, salvar/editar/excluir
```

## Como a capa é encontrada

| Plataforma | Método |
|---|---|
| YouTube / Shorts | oEmbed oficial (título, canal) + imagem `i.ytimg.com` |
| TikTok | oEmbed oficial (`tiktok.com/oembed`); links curtos são resolvidos antes |
| Instagram | página de incorporação `/p/CODE/embed/captioned/`; se falhar, tags `og:` |
| Facebook (reels/vídeos) | página buscada como o robô do Facebook (`facebookexternalhit`), que recebe as tags `og:` |
| Outros | tags `og:image` / `og:title` da página |

A imagem é baixada e guardada no Storage, então não some quando o link original expira.
Se nada funcionar, o vídeo é salvo sem capa; ao abrir o site ele tenta de novo sozinho, e dá para
trocar a capa manualmente (arquivo ou link).

## Publicar uma nova versão

- Tela: edite `docs/index.html` e rode `npx vercel deploy --prod --scope burel` (precisa do login da
  Vercel feito na máquina). Faça commit e `git push` para guardar o código no GitHub.
- API: edite `supabase/functions/videos/index.ts` e publique a função `videos` (MCP do Supabase ou
  `supabase functions deploy videos --no-verify-jwt`).

## PIN

O PIN é criado no primeiro acesso e guardado como hash em `modelar_settings` (chave `pin_hash`).
Para resetar: `delete from public.modelar_settings where key = 'pin_hash';` e abrir o site de novo.
