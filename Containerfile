# UBI9 の Node.js 18 ベースイメージ（Red Hat 提供の公式）
# kubernetes での使用に適したイメージ
FROM registry.access.redhat.com/ubi9/nodejs-18

# 作業ディレクトリ
WORKDIR /app

# OSパッケージ：unixODBC と SQLite3
USER root
RUN dnf install -y \
    unixODBC \
    unixODBC-devel \
    libsqlite3x-devel \
 && dnf clean all

# アプリの依存ファイルコピー＆インストール
COPY package*.json ./
RUN npm install

# アプリケーション本体コピー
COPY . .

# TypeScript をビルド
RUN npm run build

# ポート（例: 8080）を公開
EXPOSE 8080

# 実行ユーザーを戻す
USER 1001

# 起動コマンド
CMD ["node", "dist/index.js"]
