package com.example.tvbox

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.TextView
import androidx.recyclerview.widget.RecyclerView
import coil.load

data class TodayMatch(
    val homeName: String,
    val homeImage: String?,
    val awayName: String,
    val awayImage: String?,
    val time: String,
    val apiUrl: String?
)

class TodayMatchAdapter(
    private var items: List<TodayMatch>,
    private val onClick: (TodayMatch) -> Unit
) : RecyclerView.Adapter<TodayMatchAdapter.Holder>() {

    class Holder(view: View) : RecyclerView.ViewHolder(view) {
        val homeImage: ImageView = view.findViewById(R.id.match_home_image)
        val awayImage: ImageView = view.findViewById(R.id.match_away_image)
        val homeName: TextView = view.findViewById(R.id.match_home_name)
        val awayName: TextView = view.findViewById(R.id.match_away_name)
        val time: TextView = view.findViewById(R.id.match_time)
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder = Holder(
        LayoutInflater.from(parent.context).inflate(R.layout.item_today_match, parent, false)
    )

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val item = items[position]
        holder.homeName.text = item.homeName
        holder.awayName.text = item.awayName
        holder.time.text = item.time
        holder.homeImage.load(item.homeImage) {
            placeholder(R.drawable.media_poster_placeholder)
            error(R.drawable.media_poster_placeholder)
        }
        holder.awayImage.load(item.awayImage) {
            placeholder(R.drawable.media_poster_placeholder)
            error(R.drawable.media_poster_placeholder)
        }
        holder.itemView.isEnabled = !item.apiUrl.isNullOrBlank()
        holder.itemView.isClickable = !item.apiUrl.isNullOrBlank()
        holder.itemView.alpha = if (holder.itemView.isEnabled) 1f else 0.55f
        holder.itemView.setOnClickListener {
            if (!item.apiUrl.isNullOrBlank()) onClick(item)
        }
    }

    fun submit(newItems: List<TodayMatch>) {
        items = newItems
        notifyDataSetChanged()
    }

    override fun getItemCount(): Int = items.size
}
