# Configuração — Cronograma IDIB (app web)

O app funciona de duas formas:

| Modo | Login | Sincronia entre PC e celular |
|---|---|---|
| **Local (sem Firebase)** | Digita um nome | Não (cada aparelho mantém o seu) |
| **Com Firebase** | **Entrar com Google** | **Sim — progresso sincronizado** |

Se não configurar o Firebase, o app já funciona: é só abrir e clicar em "Entrar com Google"
(ele pede um nome e salva o progresso **só naquele aparelho**).

Para sincronizar entre PC e celular você precisa criar um projeto **gratuito** no Firebase.
Leva cerca de 15 minutos. Siga os passos abaixo.

---

## Passo 1 — Criar o projeto no Firebase

1. Acesse https://console.firebase.google.com e entre com sua conta Google.
2. Clique em **Adicionar projeto**.
   - Nome do projeto: `cronograma-idib` (ou outro).
   - Pode desmarcar o Google Analytics (opcional).
   - Clique em **Criar projeto**.

## Passo 2 — Ativar o login com Google

1. No menu lateral (ícone `⚙` ou "Criar/Site"), vá em **Authentication** → **Sign-in method**.
2. Clique em **Google** e **Ative**.
3. Preencha um **e-mail de suporte** (seu e-mail) e salve.

## Passo 3 — Criar o banco de dados Firestore

1. No menu lateral, clique em **Firestore Database** → **Create database**.
2. Escolha a região mais próxima (ex.: `europe-west3` ou `us-central1`).
3. No modo de segurança, escolha **Start in test mode** (vamos ajustar logo abaixo).
4. O banco será criado.

## Passo 4 — Liberar o acesso ao Firestore

1. No Firestore, vá na aba **Rules** (Regras).
2. Substitua tudo pelo conteúdo do arquivo **`firestore.rules`** (nesta mesma pasta).
   Regra rápida: `allow read, write: if request.auth != null;`
3. Clique em **Publish**.
   - Isso garante que **só quem tem conta Google** pode ler/gravar o próprio progresso.

## Passo 5 — Pegar os dados do projeto

1. Vá em **Project settings** (ícone `⚙` no topo) → aba **General**.
2. Na seção **Your apps**, clique no ícone **`</>` (Web)**.
3. Dê um apelido (ex.: `cronograma-web`) e clique em **Register app**.
4. Copie o bloco `firebaseConfig` que aparece na tela. É parecido com isto:

```js
const firebaseConfig = {
  apiKey: "AIzaSy...",
  authDomain: "cronograma-idib.firebaseapp.com",
  projectId: "cronograma-idib",
  storageBucket: "cronograma-idib.appspot.com",
  messagingSenderId: "1234567890",
  appId: "1:1234567890:web:abcdef..."
};
```

5. **Importante:** como os arquivos já estão na internet, adicione os domínios onde o app
   vai rodar em **Authentication → Settings → Authorized domains** e em
   **Firestore → Rules** (opcional). Na prática, o domínio de hospedagem fica liberado automaticamente.

## Passo 6 — Colar os dados no app

1. Abra o arquivo **`index.html`** desta pasta.
2. Procure o bloco:

```js
const firebaseConfig = {
  apiKey: "SEU_API_KEY",
  authDomain: "SEU_PROJETO.firebaseapp.com",
  ...
};
```

3. Substitua pelos dados reais que você copiou no passo 5.

## Passo 7 — Publicar (opcional, para usar no celular em qualquer lugar)

O jeito mais simples e **gratuito**:

### Fireb home hosting (recomendado)
1. Instale o Node.js e rode: `npm install -g firebase-tools`
2. `cd` na pasta do app e: `firebase login` → `firebase init hosting` (pasta pública: a própria pasta) → `firebase deploy`.
3. Pronto: você ganha um endereço tipo `https://cronograma-idib.web.app`.

### Ou use o Netlify Drop (sem instalar nada)
1. Acesse https://app.netlify.com/drop (arraste a pasta do app).

### Ou no seu próprio PC + celular na mesma rede Wi-Fi
1. Rode na pasta: `python3 -m http.server 8080`
2. No celular, abra `http://IP_DO_PC:8080` (descubra o IP com `ip addr` no Linux)

---

## No celular: adicionar à tela inicial (como um app)

1. Abra o endereço publicado no Chrome (Android) ou Safari (iPhone).
2. Menu do navegador → **Adicionar à tela inicial** / **Add to Home Screen**.
3. O ícone do cronograma aparece na tela inicial e abre em tela cheia, com suporte offline.

---

## Progresso entre PC e celular

- Ao marcar um item, o app salva no **Firestore** (nuvem) e também localmente.
- Abrindo com a **mesma conta Google** em outro aparelho, o progresso aparece lá automaticamente.
- Sem internet? O app continua funcionando (localStorage) e sincroniza quando voltar a conexão.

## Segurança

- As regras do Firestore (`firestore.rules`) bloqueiam qualquer pessoa sem login.
- Cada usuário só acessa o próprio documento de progresso (campo `usuarios/{uid}`).
- Os dados do banco não contêm senhas: o login é feito inteiramente pelo Google.