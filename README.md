# Pelada do Torneira ⚽

PWA para gerenciamento inteligente de times de pelada.

## Como hospedar no GitHub Pages (gratuito)

1. Acesse github.com e crie uma conta
2. Crie um repositório público chamado `pelada-torneira`
3. Faça upload de todos os arquivos desta pasta
4. Vá em Settings → Pages → Source: main / (root) → Save
5. Acesse: `https://SEU_USUARIO.github.io/pelada-torneira`

## Como instalar no Android

1. Abra o link no Chrome
2. Toque nos 3 pontinhos → "Adicionar à tela inicial"
3. Pronto — aparece como app nativo!

## Configurar Firebase (para sincronizar entre usuários)

Na primeira vez que abrir o app, ele pedirá as credenciais do Firebase.

1. Acesse console.firebase.google.com
2. Crie um projeto gratuito
3. Project Settings → General → Your apps → </> Web
4. Registre o app e copie o firebaseConfig
5. Ative Firestore Database (modo teste)
6. Cole os valores na tela de Setup do app

## Usar sem Firebase

Na tela de Setup, clique em "Usar sem Firebase".
Os dados ficarão salvos localmente no celular de quem acessar.

## Funcionalidades

- ✅ Multi-usuário: qualquer um acessa com o nome
- ✅ Sistema de Admin + co-admins
- ✅ Sorteio inteligente com Snake Draft + otimização local
- ✅ Modelo matemático: Bayesian Shrinkage + peso dinâmico
- ✅ Restrições nunca/sempre juntos (permanentes ou por domingo)
- ✅ Slider de aleatoriedade vs equilíbrio
- ✅ Ranking com índice final (2 casas decimais)
- ✅ Cálculo detalhado por jogador (4 casas decimais)
- ✅ Histórico de domingos por jogador
- ✅ Exportação em Excel/CSV
- ✅ Funciona offline após instalado
