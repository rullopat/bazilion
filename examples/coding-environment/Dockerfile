# Explicit operator preparation only. Bazilion never runs this build or pulls its base image.
FROM node:26.12.1-bookworm-slim@sha256:28147155d47dc31abe0a46e0d12b59b2fb3d0a2dcc5dc65fce76a074180b16fe
RUN npm install --global pnpm@12.15.0
RUN npm cache clean --force
WORKDIR /workspace
