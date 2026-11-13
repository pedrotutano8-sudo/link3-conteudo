FROM node:22-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu-core fontconfig poppler-utils ca-certificates curl bzip2 && rm -rf /var/lib/apt/lists/*
# Parakeet (NVIDIA, CC-BY-4.0): transcrição local, o mesmo modelo do kit Edição Sem Editor (~650 MB, fica em cache no build)
RUN mkdir -p /models && curl -fsSL https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8.tar.bz2 \
    | tar xj -C /models && mv /models/sherpa-onnx-nemo-parakeet-tdt-0.6b-v3-int8 /models/parakeet && rm -rf /models/parakeet/test_wavs
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY . .
ENV WORK_DIR=/work NODE_ENV=production PARAKEET_DIR=/models/parakeet
CMD ["node", "index.js"]
