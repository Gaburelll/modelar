# Vídeos para modelar

Site pessoal para guardar links de vídeos (TikTok, Instagram, YouTube e outros) com a capa,
plataforma, status ("para modelar" / "modelado"), etiquetas e anotações.

- **Site**: https://gaburelll.github.io/modelar/ (GitHub Pages, pasta `docs/`)
- **API**: https://fbmtuwnakzzfdyemlhcg.supabase.co/functions/v1/videos (Supabase Edge Function `videos`)

## Onde roda

- **Supabase**, projeto `maker` (`fbmtuwnakzzfdyemlhcg`, região São Paulo), org "ycoldyyx@gmail.com's Org".
  - Edge Function `videos` (acesso público, protegida por PIN próprio; CORS liberado).
  - Tabelas `public.modelar_videos` e `public.modelar_settings` (RLS ligado, só a função acessa).
  - Bucket público `modelar-thumbs` com uma cópia de cada capa.
- **GitHub Pages** serve só a tela (HTML/CSS/JS estático). O Supabase não deixa servir HTML pelo
  domínio supabase.co, por isso a tela fica separada da API.

## Estrutura

```
docs/index.html                     tela do site (HTML + CSS + JS, sem dependências)
docs/manifest.webmanifest           para "Adicionar à tela de início" no celular
docs/icon.svg, docs/icon-192.png    ícones
build.mjs                           desenha o icon-192.png (sem dependências)
supabase/functions/videos/index.ts  API: busca de capas, PIN, salvar/editar/excluir
```

## Como a capa é encontrada

| Plataforma | Método |
|---|---|
| YouTube / Shorts | oEmbed oficial (título, canal) + imagem `i.ytimg.com` |
| TikTok | oEmbed oficial (`tiktok.com/oembed`); links curtos são resolvidos antes |
| Instagram | página de incorporação `/p/CODE/embed/captioned/`; se falhar, tags `og:` |
| Outros | tags `og:image` / `og:title` da página |

A imagem é baixada e guardada no Storage, então não some quando o link original expira.
Se nada funcionar, o vídeo é salvo sem capa e dá para trocar a capa manualmente (arquivo ou link).

## Publicar uma nova versão

- Tela: edite `docs/index.html`, faça commit e `git push` (o GitHub Pages atualiza em 1–2 min).
- API: edite `supabase/functions/videos/index.ts` e publique a função `videos` (MCP do Supabase ou
  `supabase functions deploy videos --no-verify-jwt`).

## PIN

O PIN é criado no primeiro acesso e guardado como hash em `modelar_settings` (chave `pin_hash`).
Para resetar: `delete from public.modelar_settings where key = 'pin_hash';` e abrir o site de novo.
