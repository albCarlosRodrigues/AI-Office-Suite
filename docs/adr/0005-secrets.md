# ADR 0005 — Secrets

O estado operacional deve guardar apenas `secretRef`; backends nativos são Credential Manager/DPAPI, Keychain e Secret Service. Logs e erros passam por redaction. A migração do armazenamento legado deve ser compatível e nunca enviar secrets ao browser.
