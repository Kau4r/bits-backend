const { analyzeScheduleImport, importScheduleRows } = require('./scheduleImport.service');

const getUploadedWorkbook = (req) => {
  if (!req.file?.buffer) {
    return null;
  }

  return req.file.buffer;
};

const previewOfferedCourseImport = async (req, res) => {
  const workbook = getUploadedWorkbook(req);
  if (!workbook) {
    return res.status(400).json({ success: false, error: 'XLSX file is required' });
  }

  const preview = await analyzeScheduleImport(workbook, req.body);
  return res.json({ success: true, data: preview });
};

const importOfferedCourseSchedules = async (req, res) => {
  const workbook = getUploadedWorkbook(req);
  if (!workbook) {
    return res.status(400).json({ success: false, error: 'XLSX file is required' });
  }

  const result = await importScheduleRows(workbook, req.body, req.user.User_ID);
  return res.status(201).json({ success: true, data: result });
};

module.exports = {
  importOfferedCourseSchedules,
  previewOfferedCourseImport
};
