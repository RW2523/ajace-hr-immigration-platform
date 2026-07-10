-- 0013_document_extracted_text.sql
-- Persist extracted/OCR'd document text on the document record (in addition to
-- chunking it into the RAG knowledge base). `extraction_method` records how it was
-- obtained (pdf text layer, OCR, etc.) for transparency.
alter table app.documents add column if not exists extracted_text text;
alter table app.documents add column if not exists extraction_method text;
