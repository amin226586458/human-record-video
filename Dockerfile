FROM node:18-alpine

# تثبيت ffmpeg
RUN apk add --no-cache ffmpeg

# إنشاء مجلد العمل
WORKDIR /app

# نسخ ملفات package
COPY package*.json ./

# تثبيت الاعتماديات
RUN npm install

# نسخ باقي الملفات
COPY . .

# إنشاء مجلد للملفات المؤقتة
RUN mkdir -p uploads/temp

# فتح المنفذ
EXPOSE 3000

# تشغيل التطبيق
CMD ["node", "server.js"]