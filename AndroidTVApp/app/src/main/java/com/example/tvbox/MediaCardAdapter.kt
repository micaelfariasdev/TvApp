package com.example.tvbox

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import coil.load

class MediaCardAdapter(
    private var items: List<Channel>,
    private val onClick: (Channel) -> Unit
) : RecyclerView.Adapter<MediaCardAdapter.Holder>() {
    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val poster: ImageView = view.findViewById(R.id.media_card_poster)
        val title: TextView = view.findViewById(R.id.media_card_title)
        val category: TextView = view.findViewById(R.id.media_card_category)
    }

    fun submit(newItems: List<Channel>) { items = newItems; notifyDataSetChanged() }
    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int) = Holder(
        LayoutInflater.from(parent.context).inflate(R.layout.item_media_card, parent, false)
    )
    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.title.text = item.name
        holder.category.text = if (item.type.equals("series-group", true)) "SÉRIE" else "FILME"
        holder.poster.load(item.poster) {
            crossfade(true)
            placeholder(R.drawable.media_poster_placeholder)
            error(R.drawable.media_poster_placeholder)
        }
        holder.itemView.setOnClickListener { onClick(item) }
    }
    override fun getItemCount() = items.size
}
