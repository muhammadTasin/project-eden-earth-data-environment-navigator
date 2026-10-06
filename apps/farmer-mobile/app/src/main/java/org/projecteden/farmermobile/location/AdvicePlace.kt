package org.projecteden.farmermobile.location

import org.projecteden.farmermobile.data.remote.EdenApiClient
import org.projecteden.farmermobile.data.remote.PILOT_UNION_ID

/**
 * Which place the advice is for: the engine's upazila nearest the location the farmer saved on the weather screen
 * (a chosen upazila or a rounded GPS point), or the Tanore pilot when none is saved or the server cannot say.
 * Tanore itself maps to the pilot, whose 25-season replay and soil card are the most detailed.
 */
suspend fun adviceUnionId(store: LocationStore, api: EdenApiClient): String {
    val saved = store.load() ?: return PILOT_UNION_ID
    val id = api.nearestAdvicePlace(saved.latitude, saved.longitude).getOrNull()?.id ?: return PILOT_UNION_ID
    return if (id == "ADM3_Tanore") PILOT_UNION_ID else id
}
