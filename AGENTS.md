# Agent Kuralları — Git, GitHub ve Mimari Standartları

## 0. Commit Disiplini (Zorunlu)
- **Tam Yetki:** Feature/fix branch'inde çalışırken commit atmak için kullanıcıdan izin veya ek komut **bekleme**. Kullanıcı açıkça *"commit atma"* demedikçe her küçük adımı tamamladığın anda commit atmak **zorunludur** (genel "istenmedikçe commit atma" kuralı bu repoda geçersizdir).
- **Mikro Döngü (Batch Yasak):**
  `1 tekil birim düzenle → kontrol/test koş → git add <dosyalar> → git commit → sonraki birime geç`
  İşi bitirip en sonda toplu commit atmak **yasaktır**.
- **Commit Sınırları (Her biri ayrı commit):**
  1. Config, bağımlılık veya script değişikliği (`package.json`, `tsconfig`, `.github/`)
  2. `packages/shared` tip veya Zod şeması
  3. DB şeması, migration veya kurtarma/sorgu katmanı
  4. Tekil servis, provider, route grubu veya UI bileşeni (`apps/backend` ve `apps/frontend` aynı commit'te karıştırılmaz)
  5. Test ekleme veya bug fix + regresyon testi
  6. `PROGRESS.md` / doküman güncellemesi
- **Çıkış Kontrolü:** Yanıtı bitirmeden önce `git status --short` çalıştır. Açıkta iş kaldıysa (ve kullanıcı "commit atma" demediyse) atomic commit'lere bölüp commit'lemeden yanıt dönme.

## 1. Issue-First (`gh issue`)
- Kod değişikliği, yeni özellik veya tespit edilen hata için **önce GitHub Issue aç**; bağlamı, beklenen davranışı ve varsa yeniden oluşturma adımlarını net yaz.
- Başlık/etiket uyumu (`.github/ISSUE_TEMPLATE/`): hata için `[Bug]: ...` (`bug`), özellik için `[Feature]: ...` (`enhancement`), doküman için `documentation`.
- Mevcut issue kontrolü: `gh issue list`
- Issue açma:
  ```bash
  gh issue create --title "[Feature]: <short summary>" --label enhancement --body-file - <<'EOF'
  ## Summary
  <expected behavior and scope in English>

  ## Context / Steps
  1. <detail or reproduction step in English>
  EOF
  ```

## 2. Branch Kuralları
- **Yasak:** Release push'ları dışında `main` branch'ine doğrudan commit/push yapılmaz.
- Her iş güncel `main` üzerinden kendi branch'inde geliştirilir: `git checkout -b <type/scope/desc>`
- **Format:** `type/scope/desc` (ör. `feat/backend/server-lifecycle`, `fix/frontend/console-scroll`, `docs/root/agents-guidelines`).

## 3. Atomic Commit ve 50/72 Kalitesi
- **Scope Reuse:** Sabit scope listesi yoktur. Commit öncesi `git log --all --format=%s | sed -n 's/^[a-z]*(\\([a-z0-9-]*\\)).*/\\1/p' | sort | uniq -c | sort -rn` ile geçmiş scope'ları kendin tara. İş mevcut bir scope'a uyuyorsa onu kullan; çoğul/yazım varyantı türetme. Yalnızca gerçekten yeni modül/alan için küçük harf `kebab-case` yeni scope aç.
- **Başlık (`<type>(<scope>): <description>`, <= 50 karakter):**
  - İzinli `type`: `feat | fix | refactor | docs | test | chore | build | ci | perf | style | revert`
  - Küçük harfle başla, **İngilizce emir kipi** kullan (`add`, `fix`, `enforce`, `extract`, `validate`, `prevent`, `wire`, `reject`).
  - En az 2 kelime ve >= 10 karakter olsun; sona nokta (`.`) koyma; `added`/`fixing`/`updated` gibi kipler kullanma.
  - Dosya adını değil **davranışı / amacı** yaz.
  - **Yasak muğlak kalıplar:** `fix bug`, `update files`, `update code`, `improve logic`, `add changes`, `cleanup`, `wip`, `update <filename>`.
  - **Örnekler:**
    - Kötü: `fix(backend): fix bug` → İyi: `fix(process): prevent duplicate spawn on rapid start`
    - Kötü: `chore(shared): update types.ts` → İyi: `feat(shared): add log retention zod schema`
    - Kötü: `refactor(db): improve logic` → İyi: `refactor(db): batch console inserts in transaction`
- **Gövde (Body, 72 kuralı):** Başlıktan sonra **tam 1 boş satır**; zorunlu gövde (>= 15 karakter) başlığı tekrar etmez, değişikliğin *nedenini* ve kapsamını açıklar; her satır **<= 72 karakter** (uzun URL satırları hariç).
  ```text
  type(scope): imperative behavior summary in english

  Explain why this change is needed and its scope, wrapped at a
  maximum of 72 characters per line.
  ```

## 4. PR ve Merge (`gh pr`)
- Branch'ler lokalde `main`'e merge edilmez; yalnızca GitHub PR üzerinden birleştirilir.
- PR gövdesi `.github/PULL_REQUEST_TEMPLATE.md` şablonuna uymalı ve `Resolves #<issue_no>` içermelidir.
- **Push ve PR açma:**
  ```bash
  git push -u origin <branch>
  gh pr create --base main --title "type(scope): desc" --body-file - <<'EOF'
  ## Description
  <summary of changes in English>
  Resolves #<issue_no>

  ## Type of change
  - [x] <Bug fix | New feature | Breaking change | Refactor>

  ## How to Test
  1. <verification step in English>

  ## Checklist:
  - [x] My code follows the style guidelines of this project
  - [x] I have performed a self-review of my own code
  EOF
  ```
- **Kontrol, Onay ve Merge:**
  - PR açıldıktan sonra kontrolleri doğrula; **merge öncesi kullanıcı onayını bekle**.
  ```bash
  gh pr view <pr_no>
  gh pr checks <pr_no>
  ```
  - Onay geldikten sonra atomic commit geçmişini koruyan merge commit ile birleştir:
  ```bash
  gh pr merge <pr_no> --merge --delete-branch
  git checkout main && git pull origin main
  ```
  - `--merge` atomic geçmişi koruyup merge commit ekler; `--delete-branch` uzak ve lokal branch'i temizler.

## 5. Sürüm ve Release
- Yalnızca `main` branch'inde çalıştırılır:
  ```bash
  git checkout main && git pull origin main
  npm run release
  git push --follow-tags origin main
  ```
- `npm run release` (`commit-and-tag-version`) sürümü artırır, changelog'u günceller ve `v*` tag'i üretir; tag push'u `.github/workflows/release.yml` ile GitHub Release oluşturur.

## 6. Mimari, Monorepo ve `PROGRESS.md`
- **Monorepo (`npm workspaces`):**
  - `apps/backend`: Node.js 20+, TypeScript, Fastify, WebSocket, Drizzle ORM + SQLite (`better-sqlite3`, WAL, `FTS5`).
  - `apps/frontend`: React, TypeScript, Vite, TailwindCSS.
  - `packages/shared`: Ortak TypeScript tipleri, API sözleşmeleri ve Zod şemaları.
- **Mimari Kurallar:**
  - Backend ve frontend paylaşılan tipleri/Zod sözleşmelerini `packages/shared` üzerinden kullanır; duplike tip tanımlama.
  - Çalışma zamanı verileri (`data/locternos.db`, `data/servers/`, `data/runtimes/`, `data/backups/`) yalnızca `data/` altında tutulur ve commit edilmez.
  - Domain kısıtlarını koru (ör. `eula.txt` asla sessizce `true` yapılmaz, açık kullanıcı onayı beklenir).
- **`PROGRESS.md` Takibi:**
  - Geliştirme sırası `PROGRESS.md` fazlarına göre yürür (`Phase 1` → `Phase 2` → `Phase 3`).
  - Göreve başlamadan önce `PROGRESS.md` içindeki mimari kararları ve alt maddeleri referans al.
  - Yalnızca tamamlanıp doğrulanan maddeleri `[ ]` → `[x]` olarak güncelle.

## 7. Dil Kuralları
- **Kod ve Git/GitHub (Zorunlu İngilizce):** Tüm Issue'lar, PR'lar, commit mesajları, branch adları ve kod içindeki tüm tanımlayıcılar (sınıf, fonksiyon, değişken, tip, dosya adları, yorumlar) **İngilizce** olmalıdır.
- **İletişim ve Planlama (Türkçe):** Kullanıcıyla konuşma, planlama ve geliştirme tartışmaları **Türkçe** yürütülebilir.
