    // 🧠 LOAD SCENE CONTEXT CORE
    const sceneContext = await getSceneContext(req.supabase, sceneKey);

    console.log(
      '🧠 SCC →',
      sceneContext
        ? `mode=${sceneContext.interaction_mode}, subject=${sceneContext.last_subject}`
        : 'EMPTY (first message)'
    );

    /* ============================
       SUBJECT LOCK
    ============================ */

    const { subject, augmentedText } = applySubjectLock(message, sceneContext);

    if (subject && subject !== sceneContext?.last_subject) {
      await patchSceneContext(req.supabase, sceneKey, {
        last_subject: subject
      });
    }
