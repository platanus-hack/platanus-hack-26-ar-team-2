-- 0008_audio_summary.sql — resumen IA del audio de cada chunk (B-07c)
--
-- Hasta 0007 sólo persistíamos `audio_text` crudo (transcript pelado de 30s).
-- Eso forzaba a CADA brand-agent a re-procesarlo con su propia LLM call para
-- entender de qué se está hablando. Con 5 agentes activos y 1 chunk cada 30s,
-- son 5 LLM calls duplicadas por chunk → waste lineal en cantidad de marcas.
--
-- Solución: el pipeline pre-procesa UNA vez con Gemini 2.5 Flash justo antes
-- del INSERT y deja el resumen + entities cacheado en estas columnas. Los
-- brand-agents leen sólo el resumen estructurado (cheap) y caen al audio_text
-- crudo solo si necesitan más contexto.

alter table context_chunks
  add column audio_summary text,
  add column audio_topics text[],
  add column audio_mentions text[],
  add column audio_intent text check (audio_intent in ('discussion','recommendation','complaint','question','reaction','silence'));

comment on column context_chunks.audio_summary is
  'resumen IA en 1-2 oraciones de qué se está diciendo en la ventana de 30s. NULL si no hubo audio o si la summarization falló.';
comment on column context_chunks.audio_topics is
  'tópicos generales mencionados, en español, ej: ["fútbol","cerveza","comida rápida"]. Categorías amplias para matching laxo.';
comment on column context_chunks.audio_mentions is
  'entidades concretas mencionadas explícitamente: marcas, productos, personas, lugares, equipos. Ej: ["Quilmes","River Plate","Messi"]. Usado para mandate matching estricto.';
comment on column context_chunks.audio_intent is
  'intención dominante en la ventana: discussion=conversación general, recommendation=recomendando algo, complaint=quejándose, question=preguntando, reaction=reaccionando a algo, silence=sin habla.';
