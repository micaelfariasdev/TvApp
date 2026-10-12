package com.example.tvbox

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.bumptech.glide.Glide
import de.hdodenhof.circleimageview.CircleImageView

data class KickLiveChannel(
    val name: String,
    val poster: String?,
    val kickName: String,
    val isLive: Boolean = false,
    val playbackUrl: String? = null,
    val playbackEndpoint: String? = null,
    val title: String? = null,
    val viewers: Int = 0,
    val thumbnail: String? = null
)

class KickLiveAdapter(
    private var channels: List<KickLiveChannel>,
    private val onItemClick: (KickLiveChannel) -> Unit
) : RecyclerView.Adapter<KickLiveAdapter.KickLiveViewHolder>() {

    inner class KickLiveViewHolder(itemView: View) : RecyclerView.ViewHolder(itemView) {
        val channelPoster: CircleImageView = itemView.findViewById(R.id.channel_poster)
        val channelName: android.widget.TextView = itemView.findViewById(R.id.channel_name)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): KickLiveViewHolder {
        val view = LayoutInflater.from(parent.context)
            .inflate(R.layout.item_kick_live, parent, false)
        return KickLiveViewHolder(view)
    }

    override fun onBindViewHolder(holder: KickLiveViewHolder, position: Int) {
        val channel = channels[position]
        holder.channelName.text = channel.name
        Glide.with(holder.itemView.context)
            .load(channel.thumbnail ?: channel.poster)
            .placeholder(R.drawable.media_poster_placeholder)
            .error(R.drawable.media_poster_placeholder)
            .into(holder.channelPoster)
        holder.itemView.setOnClickListener { onItemClick(channel) }
    }

    fun submit(items: List<KickLiveChannel>) {
        channels = items
        notifyDataSetChanged()
    }

    override fun getItemCount(): Int = channels.size
}