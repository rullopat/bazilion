# Explicit operator preparation only. Bazilion never runs this build or pulls its base image.
FROM node:24.13.0-bookworm-slim@sha256:4660b1ca8b28d6d1906fd644abe34b2ed81d15434d26d845ef0aced307cf4b6f
RUN npm install --global pnpm@10.28.2
RUN npm cache clean --force
WORKDIR /workspace
