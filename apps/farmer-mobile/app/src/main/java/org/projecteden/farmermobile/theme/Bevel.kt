package org.projecteden.farmermobile.theme

import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.drawWithContent
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.unit.dp

/** The story site's sharp corner: every slab, button and field uses it. */
val EdenShape = RoundedCornerShape(2.dp)

/** A raised slab, lit from the top left: a light top and left edge, a shaded bottom and right edge. */
fun Modifier.bevel(): Modifier = drawWithContent {
    drawContent()
    val w = 1.5.dp.toPx()
    drawRect(BevelLight, Offset.Zero, Size(size.width, w))
    drawRect(BevelLight, Offset.Zero, Size(w, size.height))
    drawRect(BevelShade, Offset(0f, size.height - w), Size(size.width, w))
    drawRect(BevelShade, Offset(size.width - w, 0f), Size(w, size.height))
}

/** A sunk well (inputs, tracks): the shade on the top and left edge, the light on the bottom and right. */
fun Modifier.sunk(): Modifier = drawWithContent {
    drawContent()
    val w = 1.5.dp.toPx()
    drawRect(BevelShade, Offset.Zero, Size(size.width, w))
    drawRect(BevelShade, Offset.Zero, Size(w, size.height))
    drawRect(BevelLight, Offset(0f, size.height - w), Size(size.width, w))
    drawRect(BevelLight, Offset(size.width - w, 0f), Size(w, size.height))
}
