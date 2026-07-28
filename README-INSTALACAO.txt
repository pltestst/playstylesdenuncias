BRASIL STYLE DENÚNCIAS V26 - SUPABASE

O site já está conectado ao seu projeto Supabase.
Antes de publicar, faça estes passos:

1) CRIAR TABELAS E SEGURANÇA
- Abra o Supabase.
- Entre em SQL Editor > New query.
- Abra o arquivo supabase/setup.sql deste ZIP.
- Copie tudo, cole no SQL Editor e clique em Run.

2) CRIAR A CONTA DO FUNDADOR
- Vá em Authentication > Users > Add user > Create new user.
- E-mail: bpvpaulo@staff.brasilstyle.local
- Senha: escolha uma senha forte com pelo menos 8 caracteres.
- Marque para confirmar o e-mail automaticamente, se essa opção aparecer.
- Depois volte ao SQL Editor e execute, trocando o nome se desejar:

update public.profiles
set username='bpvpaulo', display_name='BPV Paulo', role='founder', active=true
where id=(select id from auth.users where email='bpvpaulo@staff.brasilstyle.local');

3) PUBLICAR A FUNÇÃO QUE CRIA ADMINISTRADORES
A função está em supabase/functions/manage-admins/index.ts.
Ela precisa ser publicada como Edge Function com o nome: manage-admins

Pelo Supabase Dashboard:
- Edge Functions > Deploy a new function.
- Nome: manage-admins
- Cole o conteúdo do arquivo index.ts.
- Faça o deploy.

As variáveis SUPABASE_URL, SUPABASE_ANON_KEY e SUPABASE_SERVICE_ROLE_KEY
normalmente são disponibilizadas automaticamente para Edge Functions do projeto.
NUNCA coloque a service_role no arquivo supabase-config.js ou no site público.

4) TESTAR
- Abra index.html usando Live Server no VS Code.
- Entre na Área da Staff com:
  Usuário: bpvpaulo
  Senha: a senha que você criou no Supabase.
- No painel aparecerá “Gerenciar administradores”.

5) PUBLICAR SEM GITHUB
- Netlify Drop: compacte ou arraste a pasta do site no painel da Netlify.
- Também pode usar qualquer hospedagem de site estático.

IMPORTANTE
- A Publishable Key presente no site é própria para uso no navegador.
- Não compartilhe a Secret Key/service_role.
- As denúncias antigas do localStorage não são enviadas automaticamente ao Supabase.
