package org.projecteden.farmermobile.data.model

import androidx.room.Entity
import androidx.room.PrimaryKey

/**
 * Cached seasonal advice. The defaults are the offline seed shown before the first sync: they mirror the engine's
 * farmer card for the Talanda pilot (data release tanore-2026.09.29), and test_pipeline.ts TEST 9 fails if they drift.
 * A successful sync replaces them with the server's advice. Fields without data say "তথ্য পাওয়া যায়নি".
 */
@Entity(tableName = "cached_advice")
data class AdviceEntity(
    @PrimaryKey
    val id: String = "current_seasonal_advice",
    val plotName: String = "পূর্ব মাঠ – প্লট ০২ (তালন্দ এলাকা)",
    val blockTag: String = "আমন ব্লক",
    val guidelineApproval: String = "নাসা ২৫ মৌসুমের তথ্য ও SRDI কার্ড অনুযায়ী",
    val cacheTimeString: String = "অফলাইন ক্যাশ",
    val rotationTitle: String = "আমন ধান → মসুর",
    val rotationSubtitle: String = "ব্রি ধান৭১ কেটে বারি মসুর-৮: পানি সাশ্রয়ী, মাটি সমৃদ্ধকারী",
    // Season 1 (Aman)
    val season1Name: String = "আমন ধান",
    val season1Variety: String = "ব্রি ধান৭১",
    val season1Window: String = "রোপণ: ~১ আগস্ট • কাটা: ~৩ নভেম্বর",
    val season1Stage: String = "থোড় আসার পর্যায়",
    val season1SoilStatus: String = "খিয়ার মাটি, মাঝারি উঁচু জমি (SRDI)",
    val season1IrrigationStatus: String = "২৫ মৌসুমের ৭টিতে ফুল আসার সময় সম্পূরক সেচ লেগেছে",
    // Season 2 (Rabi)
    val season2Name: String = "মসুর",
    val season2Variety: String = "বারি মসুর-৮",
    val season2Window: String = "বপন: ~১০ নভেম্বর (শেষ সময় ১৪ নভেম্বর) • কাটা: ~১ মার্চ",
    val season2Notes: String = "সেচ লাগে প্রায় ১৯৯ মিমি; ডাল ফসল মাটিতে নাইট্রোজেন যোগ করে",
    val season2FertilizerRecommendation: String = "প্রতি বিঘায় (৩৩ শতক) ইউরিয়া ৭.৩, টিএসপি ১৪.৪, এমওপি ৪.৮ কেজি (SRDI তালন্দ কার্ড)",
    // Narrative Advisory
    val narrativeAdvice: String = "ব্রি ধান৭১ ১০ নভেম্বরের মধ্যে জমি খালি করে, তাই মসুর সময়মতো বোনা যায়। বোরোর বদলে মসুর করলে হেক্টরে প্রায় ৫,৯৮০ ঘনমিটার ভূগর্ভস্থ পানি বাঁচে।",
    // Alternative crop (the engine's second-ranked rotation)
    val alternativeCropName: String = "সরিষা (বারি সরিষা-১৪)",
    val alternativeCropCategory: String = "কম সেচ",
    val alternativeCropSowing: String = "~১০ নভেম্বর (শেষ সময় ১৫ নভেম্বর)",
    val alternativeCropYield: String = "জেলার গড় ১.৫ টন/হেক্টর (BBS)",
    val alternativeCropMarketPrice: String = "তথ্য পাওয়া যায়নি",
    // Provenance
    val provenanceNotice: String = "তথ্যসূত্র: নাসা POWER ও GPM IMERG দিয়ে ২৫ মৌসুমের পানির হিসাব, SRDI তালন্দ কার্ড, BRRI/BARI সময়সূচি। রিলিজ tanore-2026.09.29।",
    // Metadata
    val isOffline: Boolean = true,
    val lastSyncFormatted: String = "এখনো সিঙ্ক হয়নি",
    val audioDurationSeconds: Int = 30,
    val audioScriptBangla: String = "মাটি কহন থেকে বলছি। তালন্দ ইউনিয়নের মাঝারি উঁচু জমির জন্য প্রস্তাবিত ফসল চক্র: ব্রি ধান৭১ → বারি মসুর-৮ (পানি সাশ্রয়ী, মাটি সমৃদ্ধকারী)। গত ২৫ মৌসুমের নাসা তথ্যে ব্রি ধান৭১ লাগালে ফুল আসার সময় ৭ বার বাড়তি সেচ লেগেছে। ১০ নভেম্বরের মধ্যে ধান কেটে মসুর বুনলে সেচ লাগবে প্রায় ১৯৯ মিলিমিটার। প্রশ্ন থাকলে আপনার উপসহকারী কৃষি কর্মকর্তার (SAAO) সাথে কথা বলুন। ধন্যবাদ।",
    val updatedAt: Long = System.currentTimeMillis()
)

/**
 * Historical advice entity for past seasons.
 */
@Entity(tableName = "advice_history")
data class AdviceHistoryEntity(
    @PrimaryKey
    val id: String = "hist_01",
    val seasonTag: String = "সর্বশেষ পরামর্শ • চলতি মৌসুম",
    val rotationTitle: String = "আমন ধান (ব্রি ধান৭১) → মসুর",
    val adviceSummary: String = "ব্রি ধান৭১ ১০ নভেম্বরের মধ্যে জমি খালি করে, তাই মসুর সময়মতো বোনা যায়। বোরোর বদলে মসুর করলে হেক্টরে প্রায় ৫,৯৮০ ঘনমিটার ভূগর্ভস্থ পানি বাঁচে।",
    val hasListenedAudio: Boolean = false,
    val syncTimestamp: String = "এখনো সিঙ্ক হয়নি",
    val createdAt: Long = System.currentTimeMillis()
)
