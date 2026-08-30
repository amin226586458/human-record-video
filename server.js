const express = require('express');
const multer = require('multer');
const axios = require('axios');
const FormData = require('form-data');
const fs = require('fs');
const path = require('path');
const ffmpeg = require('fluent-ffmpeg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 3000;

// ============================================
// 0. إعدادات إضافية للتوافق مع Northflank
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

// إضافة middleware للتسجيل
app.use((req, res, next) => {
  console.log(`📝 ${req.method} ${req.url}`);
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// ============================================
// 1. إعداد Multer (لحفظ الملفات مؤقتاً)
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
    // قبول أنواع الفيديو المختلفة
    const allowedTypes = ['video/mp4', 'video/webm', 'video/avi', 'video/mov', 'video/quicktime'];
    if (allowedTypes.includes(file.mimetype) || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('نوع الملف غير مدعوم. يرجى رفع فيديو فقط.'));
    }
  }
});

// ============================================
// 2. دالة تحويل الفيديو إلى MP4
// ============================================
function convertToMp4(inputPath, outputPath) {
  return new Promise((resolve, reject) => {
    console.log('🔄 جاري تحويل الفيديو إلى MP4...');
    console.log(`   - المصدر: ${inputPath}`);
    console.log(`   - الهدف: ${outputPath}`);

    // التحقق من وجود ffmpeg
    try {
      ffmpeg.getAvailableCodecs();
    } catch (error) {
      console.warn('⚠️ تحذير: قد لا يكون ffmpeg مثبتاً بشكل صحيح');
    }

    ffmpeg(inputPath)
      .outputOptions([
        '-c:v libx264',
        '-c:a aac',
        '-movflags +faststart',
        '-preset medium',
        '-crf 23',
        '-pix_fmt yuv420p'
      ])
      .on('start', (commandLine) => {
        console.log('   - بدء التحويل بالأمر:', commandLine);
      })
      .on('progress', (progress) => {
        if (progress.percent && Math.floor(progress.percent) % 10 === 0) {
          console.log(`   - التقدم: ${Math.floor(progress.percent)}%`);
        }
      })
      .on('end', () => {
        console.log('✅ تم تحويل الفيديو إلى MP4 بنجاح');
        resolve();
      })
      .on('error', (err) => {
        console.error('❌ فشل تحويل الفيديو:', err.message);
        reject(err);
      })
      .save(outputPath);
  });
}

// ============================================
// 3. دالة إرسال الفيديو إلى تيليجرام
// ============================================
async function sendVideoToTelegram(filePath, fileName) {
  try {
    const BOT_TOKEN = process.env.BOT_TOKEN;
    const CHAT_ID = process.env.CHAT_ID;

    if (!BOT_TOKEN || !CHAT_ID) {
      throw new Error('❌ التوكن أو الـ Chat ID غير موجود في ملف .env');
    }

    console.log('📤 جاري إرسال الفيديو إلى تيليجرام...');
    console.log(`   - الملف: ${filePath}`);
    console.log(`   - الحجم: ${(fs.statSync(filePath).size / 1024 / 1024).toFixed(2)} MB`);

    // إنشاء كائن FormData لإرسال الملف
    const formData = new FormData();
    formData.append('chat_id', CHAT_ID);
    formData.append('video', fs.createReadStream(filePath));
    formData.append('caption', '✅ تم التحقق من هويتك بنجاح! 🎥');
    formData.append('supports_streaming', 'true');

    // إرسال الطلب إلى API التيليجرام
    const response = await axios.post(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendVideo`,
      formData,
      {
        headers: {
          ...formData.getHeaders()
        },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
        timeout: 60000 // 60 ثانية مهلة
      }
    );

    console.log('✅ تم إرسال الفيديو إلى تيليجرام بنجاح!');
    console.log('📊 تفاصيل الإرسال:');
    console.log(`   - Message ID: ${response.data.result.message_id}`);
    console.log(`   - File ID: ${response.data.result.video.file_id}`);
    console.log(`   - حجم الفيديو: ${response.data.result.video.file_size} بايت`);
    
    return response.data;

  } catch (error) {
    console.error('❌ فشل إرسال الفيديو إلى تيليجرام:');
    if (error.response) {
      console.error('   - الرد من التيليجرام:', JSON.stringify(error.response.data, null, 2));
    } else {
      console.error('   - الخطأ:', error.message);
    }
    throw error;
  }
}

// ============================================
// 4. دالة حذف الملفات المؤقتة
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
// 5. نقطة نهاية استقبال الفيديو
// ============================================
app.post("/upload", upload.single("video"), async (req, res) => {
  console.log('📹 POST /upload received');
  console.log('========================================');

  let inputPath = null;
  let outputPath = null;

  try {
    // التحقق من وجود ملف
    if (!req.file) {
      console.error('❌ لا يوجد ملف في الطلب');
      return res.status(400).json({
        success: false,
        message: "لم يتم استلام فيديو. تأكد من إرسال حقل باسم 'video'"
      });
    }

    inputPath = req.file.path;
    const inputExt = path.extname(req.file.originalname).toLowerCase();
    const fileNameWithoutExt = path.basename(req.file.originalname, inputExt);
    
    // إنشاء مسار للملف المحول (MP4)
    const outputFileName = `output-${Date.now()}-${fileNameWithoutExt}.mp4`;
    outputPath = path.join(TEMP_DIR, outputFileName);

    const fileSize = (req.file.size / 1024 / 1024).toFixed(2);

    console.log('📁 معلومات الفيديو المستقبل:');
    console.log(`   - الاسم: ${req.file.originalname}`);
    console.log(`   - الصيغة: ${inputExt}`);
    console.log(`   - الحجم: ${fileSize} MB`);
    console.log(`   - النوع: ${req.file.mimetype}`);
    console.log(`   - المسار: ${inputPath}`);

    // ==========================================
    // تحويل الفيديو إلى MP4 إذا لم يكن MP4 بالفعل
    // ==========================================
    if (inputExt !== '.mp4') {
      await convertToMp4(inputPath, outputPath);
      const outputSize = (fs.statSync(outputPath).size / 1024 / 1024).toFixed(2);
      console.log(`   - الحجم بعد التحويل: ${outputSize} MB`);
    } else {
      console.log('ℹ️ الفيديو بصيغة MP4 بالفعل، لا حاجة للتحويل');
      outputPath = inputPath; // استخدم الملف الأصلي
    }

    // ==========================================
    // إرسال الفيديو إلى تيليجرام
    // ==========================================
    const result = await sendVideoToTelegram(outputPath, fileNameWithoutExt + '.mp4');

    // ==========================================
    // حذف الملفات المؤقتة
    // ==========================================
    const filesToDelete = [inputPath];
    if (outputPath !== inputPath) {
      filesToDelete.push(outputPath);
    }
    deleteTempFiles(filesToDelete);

    // ==========================================
    // رد للمستخدم
    // ==========================================
    res.status(200).json({
      success: true,
      message: "✅ تم استلام الفيديو وتحويله إلى MP4 وإرساله إلى تيليجرام بنجاح",
      data: {
        original_filename: req.file.originalname,
        converted_filename: fileNameWithoutExt + '.mp4',
        original_size: `${fileSize} MB`,
        telegram: {
          message_id: result.result.message_id,
          file_id: result.result.video.file_id
        }
      }
    });

  } catch (error) {
    console.error('❌ خطأ:', error);
    
    // حذف الملفات المؤقتة في حالة الخطأ
    const filesToDelete = [];
    if (inputPath) filesToDelete.push(inputPath);
    if (outputPath && outputPath !== inputPath) filesToDelete.push(outputPath);
    if (filesToDelete.length > 0) {
      deleteTempFiles(filesToDelete);
    }

    res.status(500).json({
      success: false,
      message: "حدث خطأ أثناء معالجة الفيديو",
      error: error.message
    });
  }
});

// ============================================
// 6. نقطة نهاية لاختبار البوت
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
// 7. صفحة رئيسية بسيطة
// ============================================
app.use(express.static(__dirname));

app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});

// ============================================
// 8. تشغيل الخادم
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
  console.log('🔄 تحويل تلقائي من أي صيغة إلى MP4');
  console.log('========================================');
});