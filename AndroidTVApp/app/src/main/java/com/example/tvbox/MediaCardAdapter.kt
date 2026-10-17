
package com.example.tvbox

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.content.res.Configuration
import android.widget.ImageView
import android.widget.TextView
import android.widget.ProgressBar
import androidx.recyclerview.widget.RecyclerView
import coil.load

class MediaCardAdapter(
    private var items: List<Channel>,
    private val gridMode: Boolean = false,
    private val onClick: (Channel) -> Unit,
    private val progressProvider: (Channel) -> Int = { 0 }
) : RecyclerView.Adapter<MediaCardAdapter.Holder>() {

    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val poster: ImageView = view.findViewById(R.id.media_card_poster)
        val title: TextView = view.findViewById(R.id.media_card_title)
        val category: TextView = view.findViewById(R.id.media_card_category)
        val progress: ProgressBar = view.findViewById(R.id.media_card_progress)
    }

    fun submit(newItems: List<Channel>) {
        items = newItems
        notifyDataSetChanged()
    }

    override fun onCreateViewHolder(
        parent: ViewGroup,
        viewType: Int
    ): Holder {
        val view = LayoutInflater.from(parent.context)
            .inflate(
                if (gridMode) R.layout.item_media_grid_card else R.layout.item_media_card,
                parent,
                false
            )

        return Holder(view)
    }

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]

        val isSeries = item.type.equals("series-group", ignoreCase = true)

        val isEpisode = !isSeries &&
            item.category.equals("series", ignoreCase = true) &&
            item.episode != null

        // Canais ao vivo ficam quadrados; conteúdo sob demanda continua em pôster vertical.
        val isLive = !isSeries && !isEpisode && item.type.lowercase() in setOf(
            "hls", "kick", "iframe", "embed", "football-group", "match-group"
        )
        updateGridCardSize(holder, isLive)

        holder.title.text = item.name
        val progress = progressProvider(item).coerceIn(0, 1000)
        holder.progress.visibility = if (progress > 0 && !isLive) View.VISIBLE else View.GONE
        holder.progress.progress = progress

        holder.category.text = when {
            isEpisode -> {
                val season = item.season ?: 1
                val episode = item.episode ?: 1
                "T${season} • EP${episode}"
            }
            isSeries -> "SÉRIE"
            item.type.equals("kick", ignoreCase = true) -> "AO VIVO"
            item.category.equals("futebol", ignoreCase = true) -> "AO VIVO"
            else -> item.category?.uppercase()?.takeIf { it.isNotBlank() } ?: "FILME"
        }

        holder.poster.load(item.poster) {
            crossfade(true)
            placeholder(R.drawable.media_poster_placeholder)
            error(R.drawable.media_poster_placeholder)
        }

        holder.itemView.setOnClickListener {
            onClick(item)
        }
        val isTv = (holder.itemView.resources.configuration.uiMode and Configuration.UI_MODE_TYPE_MASK) ==
            Configuration.UI_MODE_TYPE_TELEVISION
        // No celular/tablet o primeiro toque já deve abrir o item; o foco
        // visual é necessário apenas para navegação por controle remoto.
        holder.itemView.isFocusable = isTv
        holder.itemView.isFocusableInTouchMode = isTv
    }

    override fun getItemCount(): Int = items.size

    private fun updateGridCardSize(holder: Holder, isLive: Boolean) {
        if (!gridMode) return

        holder.itemView.post {
            val width = holder.itemView.width
            if (width <= 0) return@post

            val targetHeight = if (isLive) width else (width * 1.25f).toInt()
            val params = holder.itemView.layoutParams ?: return@post
            if (params.height != targetHeight) {
                params.height = targetHeight
                holder.itemView.layoutParams = params
            }
        }
    }

    private fun dp(view: View, value: Int): Int =
        (value * view.resources.displayMetrics.density).toInt()
}
